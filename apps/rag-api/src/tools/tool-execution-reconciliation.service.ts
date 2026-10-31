import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AgentRuntimeEventsService } from '../modules/agent-runtime-events/agent-runtime-events.service';
import { RedisProvider } from '../providers/redis/redis.provider';

export type ToolReconciliationResolution =
  | 'completed'
  | 'not_applied'
  | 'compensated';

type ToolReconciliationRecoveryMode = 'unknown_event' | 'call_only';
type ToolReconciliationTransitionMode =
  | 'unknown_marker'
  | 'expired_running_marker'
  | 'missing_marker'
  | 'already_completed';

type ToolReconciliationInput = {
  /** Set by the RBAC-protected Admin API from the persisted run scope. */
  tenantId: string;
  threadId: string;
  /** Optional in older Agent Loop callers; resolved from the unique call event. */
  runId?: string;
  resolution: ToolReconciliationResolution;
  evidenceRef: string;
  /** Supplied by the RBAC-protected Admin API, never trusted from browser input. */
  operatorId: string;
};

type ResolvedToolReconciliationInput = Omit<
  ToolReconciliationInput,
  'runId'
> & {
  runId: string | null;
};

type RuntimeEvent = {
  tenantId: string;
  threadId: string;
  runId: string | null;
  eventType: string;
  actor: string;
  target: string | null;
  sequence: number;
  payload: unknown;
};

type ReconciliationRequest = ResolvedToolReconciliationInput & {
  callId: string;
  toolName: string;
  reconciliationId: string;
  scopeFingerprint: string;
  idempotencyFingerprint: string;
  recoveryMode: ToolReconciliationRecoveryMode;
  transitionMode?: ToolReconciliationTransitionMode;
};

const CALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECONCILIATION_LOCK_TTL_SECONDS = 60;
const MAX_EVENT_PAGES = 100;
const TERMINAL_TOOL_EVENTS = new Set([
  'tool.result',
  'tool.unknown',
  'tool.failed',
  'tool.blocked',
]);

@Injectable()
export class ToolExecutionReconciliationService {
  constructor(
    private readonly runtimeEvents: AgentRuntimeEventsService,
    private readonly redis: RedisProvider,
  ) {}

  async reconcile(callId: string, body: unknown) {
    if (!CALL_ID_PATTERN.test(callId)) {
      throw new BadRequestException('callId must be a UUID');
    }
    const input = this.parseInput(body);
    const events = await this.findCallEvents(
      input.tenantId,
      input.threadId,
      input.runId,
      callId,
    );
    const callEvents = events.filter(
      (event) => event.eventType === 'tool.call',
    );
    if (callEvents.length !== 1) {
      throw new NotFoundException(
        'A unique tool call was not found in this tenant, thread, and run.',
      );
    }

    const callEvent = callEvents[0];
    if (input.runId !== undefined && callEvent.runId !== input.runId) {
      throw new NotFoundException(
        'The tool call was not found in the requested run.',
      );
    }
    const scopedInput: ResolvedToolReconciliationInput = {
      ...input,
      runId: callEvent.runId,
    };
    const scopedEvents = events.filter(
      (event) => event.runId === callEvent.runId,
    );
    if (scopedEvents.length !== events.length) {
      throw new ConflictException(
        'The call ID is associated with multiple runs in this tenant and thread.',
      );
    }
    const unknownEvents = scopedEvents.filter(
      (event) => event.eventType === 'tool.unknown',
    );
    const terminalEvents = scopedEvents.filter((event) =>
      TERMINAL_TOOL_EVENTS.has(event.eventType),
    );
    if (unknownEvents.length > 1) {
      throw new ConflictException(
        'The call ID has multiple unknown terminal events.',
      );
    }
    const unknownEvent = unknownEvents[0];
    const callPayload = this.asRecord(callEvent.payload);
    const unknownPayload = unknownEvent
      ? this.asRecord(unknownEvent.payload)
      : undefined;
    const toolName = this.readRequiredText(callEvent.target, 'toolName', 128);
    const recoveryMode: ToolReconciliationRecoveryMode = unknownEvent
      ? 'unknown_event'
      : 'call_only';

    if (
      !this.eventMatchesScope(callEvent, scopedInput) ||
      callPayload.callId !== callId ||
      callPayload.permission !== 'write' ||
      callPayload.sideEffect !== true ||
      callPayload.legacyMarkerCheck !== 'clear'
    ) {
      throw new ConflictException(
        'The tool call is not a scoped write call with a clear legacy-marker check.',
      );
    }
    if (
      terminalEvents.some(
        (event) =>
          !this.eventMatchesScope(event, scopedInput) ||
          event.target !== toolName ||
          this.asRecord(event.payload).callId !== callId,
      )
    ) {
      throw new ConflictException(
        'A terminal tool event has a mismatched scope.',
      );
    }
    if (unknownEvent) {
      if (
        terminalEvents.length !== 1 ||
        terminalEvents[0].eventType !== 'tool.unknown' ||
        !this.eventMatchesScope(unknownEvent, scopedInput) ||
        unknownEvent.target !== toolName ||
        unknownPayload?.callId !== callId ||
        unknownPayload?.status !== 'unknown'
      ) {
        throw new ConflictException(
          'Runtime events do not describe one unknown side-effect call.',
        );
      }
    } else if (terminalEvents.length !== 0) {
      throw new ConflictException(
        'The tool call has a terminal event and cannot use the missing-marker recovery path.',
      );
    }

    const keyRef = this.readRequiredText(
      unknownPayload?.idempotencyKeyRef ?? callPayload.idempotencyKeyRef,
      'idempotencyKeyRef',
      64,
    );
    const scopeFingerprint = this.readRequiredText(
      callPayload.idempotencyScopeFingerprint,
      'idempotencyScopeFingerprint',
      64,
    );
    const idempotencyFingerprint = this.readRequiredText(
      unknownPayload?.idempotencyFingerprint ??
        callPayload.idempotencyFingerprint,
      'idempotencyFingerprint',
      64,
    );
    if (
      !/^[0-9a-f]{64}$/i.test(keyRef) ||
      !/^[0-9a-f]{64}$/i.test(scopeFingerprint) ||
      !/^[0-9a-f]{64}$/i.test(idempotencyFingerprint) ||
      scopeFingerprint !==
        this.scopeFingerprint(
          scopedInput.tenantId,
          scopedInput.threadId,
          toolName,
          keyRef,
        ) ||
      callPayload.idempotencyScopeFingerprint !== scopeFingerprint ||
      callPayload.idempotencyFingerprint !== idempotencyFingerprint ||
      (unknownPayload &&
        (unknownPayload.idempotencyKeyRef !== keyRef ||
          unknownPayload.idempotencyScopeFingerprint !== scopeFingerprint ||
          unknownPayload.idempotencyFingerprint !== idempotencyFingerprint)) ||
      idempotencyFingerprint !==
        this.fingerprint(
          scopedInput.tenantId,
          scopedInput.threadId,
          scopedInput.runId,
          callId,
          toolName,
          keyRef,
        )
    ) {
      throw new ConflictException(
        'Tool idempotency scope or fingerprint does not match the runtime events.',
      );
    }

    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException(
        'Redis is unavailable; tool reconciliation is fail-closed.',
      );
    }
    const redisScope = `tool-execution:scope:{${scopeFingerprint}}`;
    const redisKey = `${redisScope}:state`;
    const leaseKey = `${redisScope}:lease`;
    const reconcileLockKey = `${redisScope}:reconcile:${idempotencyFingerprint}`;
    const reconcileLockToken = randomUUID();
    const locked = await this.redis.setIfAbsentRequired(
      reconcileLockKey,
      reconcileLockToken,
      RECONCILIATION_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      throw new ConflictException(
        'Another reconciliation is already in progress for this tool call.',
      );
    }

    try {
      return await this.reconcileLocked(
        {
          ...scopedInput,
          callId,
          toolName,
          reconciliationId: randomUUID(),
          scopeFingerprint,
          idempotencyFingerprint,
          recoveryMode,
        },
        redisKey,
        leaseKey,
        scopedEvents,
      );
    } finally {
      try {
        await this.redis.compareAndDeleteRequired(
          reconcileLockKey,
          reconcileLockToken,
        );
      } catch {
        // The lease expires automatically; release failure must not change the tool key.
      }
    }
  }

  private async reconcileLocked(
    request: ReconciliationRequest,
    redisKey: string,
    leaseKey: string,
    previousEvents: RuntimeEvent[],
  ) {
    const reconciledEvent = previousEvents.find((event) => {
      if (event.eventType !== 'tool.reconciled') return false;
      return this.asRecord(event.payload).callId === request.callId;
    });
    if (reconciledEvent) {
      return this.readCompletedReconciliation(
        reconciledEvent,
        request,
        redisKey,
        leaseKey,
      );
    }

    const existingRequest = previousEvents.find((event) => {
      if (event.eventType !== 'tool.reconciliation.requested') return false;
      return this.asRecord(event.payload).callId === request.callId;
    });
    if (existingRequest) {
      if (
        !this.eventMatchesScope(existingRequest, request) ||
        existingRequest.target !== request.toolName
      ) {
        throw new ConflictException(
          'Existing reconciliation request scope does not match.',
        );
      }
      const payload = this.asRecord(existingRequest.payload);
      if (
        payload.operatorId !== request.operatorId ||
        payload.resolution !== request.resolution ||
        payload.evidenceRef !== request.evidenceRef ||
        payload.idempotencyFingerprint !== request.idempotencyFingerprint ||
        payload.scopeFingerprint !== request.scopeFingerprint ||
        payload.recoveryMode !== request.recoveryMode
      ) {
        throw new ConflictException(
          'A different reconciliation request is already recorded; inspect the runtime events before proceeding.',
        );
      }
      const transitionMode = payload.transitionMode;
      if (
        transitionMode !== 'unknown_marker' &&
        transitionMode !== 'expired_running_marker' &&
        transitionMode !== 'missing_marker' &&
        transitionMode !== 'already_completed'
      ) {
        throw new ConflictException(
          'The previous reconciliation request has no valid transition mode.',
        );
      }
      request.transitionMode = transitionMode;
      request.reconciliationId = this.readRequiredText(
        payload.reconciliationId,
        'reconciliationId',
        64,
      );
    }

    const current = await this.redis.getRequired(redisKey);
    const activeLease = await this.redis.getRequired(leaseKey);
    const unknownMarker = `unknown:${request.scopeFingerprint}:${request.idempotencyFingerprint}:${request.callId}`;
    const runningMarker = `running:${request.scopeFingerprint}:${request.idempotencyFingerprint}:${request.callId}`;
    const completedMarker = `reconciled:completed:${request.scopeFingerprint}:${request.reconciliationId}`;
    const completedOutputPrefix = `completed:${request.scopeFingerprint}:${request.idempotencyFingerprint}:`;
    const receiptKey = `tool-execution:scope:{${request.scopeFingerprint}}:receipt:${request.idempotencyFingerprint}`;
    const releasedReceipt = `released:${request.resolution}:${request.reconciliationId}`;
    const receipt = await this.redis.getRequired(receiptKey);
    const lockBefore =
      current === null
        ? 'absent'
        : current.startsWith(completedOutputPrefix)
          ? 'completed'
          : current === unknownMarker
            ? 'unknown'
            : current === runningMarker
              ? 'running'
              : 'other';
    let alreadyApplied = false;

    if (!existingRequest) {
      if (current === unknownMarker && activeLease === null) {
        request.transitionMode = 'unknown_marker';
      } else if (current === runningMarker && activeLease === null) {
        request.transitionMode = 'expired_running_marker';
      } else if (current === null && activeLease === null) {
        request.transitionMode = 'missing_marker';
      } else if (
        request.resolution === 'completed' &&
        activeLease === null &&
        current?.startsWith(completedOutputPrefix)
      ) {
        request.transitionMode = 'already_completed';
      } else {
        throw new ConflictException(
          'The scoped state is active or does not match this call; reconciliation will not alter it.',
        );
      }
    }

    const transitionMode = request.transitionMode!;
    if (request.resolution === 'completed') {
      if (receipt !== null) {
        throw new ConflictException(
          'A release receipt already exists for this call; completed resolution is rejected.',
        );
      }
      alreadyApplied =
        current === completedMarker ||
        (transitionMode === 'already_completed' &&
          current?.startsWith(completedOutputPrefix) === true);
      const expectedCurrent =
        transitionMode === 'unknown_marker'
          ? unknownMarker
          : transitionMode === 'expired_running_marker'
            ? runningMarker
            : null;
      if (transitionMode === 'already_completed' && !alreadyApplied) {
        throw new ConflictException(
          'The completed tool state no longer matches this call fingerprint.',
        );
      }
      if (
        !alreadyApplied &&
        (current !== expectedCurrent || activeLease !== null)
      ) {
        throw new ConflictException(
          'The scoped marker must be matching and have no active lease before reconciliation.',
        );
      }
      if (alreadyApplied && activeLease !== null) {
        throw new ConflictException(
          'A completed state still has an active lease; reconciliation is rejected.',
        );
      }
    } else {
      alreadyApplied = receipt === releasedReceipt;
      const expectedCurrent =
        transitionMode === 'unknown_marker'
          ? unknownMarker
          : transitionMode === 'expired_running_marker'
            ? runningMarker
            : null;
      if (
        alreadyApplied &&
        (current === unknownMarker || current === runningMarker)
      ) {
        throw new ConflictException(
          'The released marker reappeared after its receipt was written.',
        );
      }
      if (
        !alreadyApplied &&
        (receipt !== null ||
          current !== expectedCurrent ||
          activeLease !== null)
      ) {
        throw new ConflictException(
          'A matching expired marker or absent state and no active lease are required before release.',
        );
      }
    }

    if (!existingRequest) {
      await this.runtimeEvents.emit({
        tenantId: request.tenantId,
        threadId: request.threadId,
        runId: request.runId ?? undefined,
        eventType: 'tool.reconciliation.requested',
        actor: request.operatorId,
        target: request.toolName,
        payload: {
          callId: request.callId,
          reconciliationId: request.reconciliationId,
          operatorId: request.operatorId,
          resolution: request.resolution,
          evidenceRef: request.evidenceRef,
          scopeFingerprint: request.scopeFingerprint,
          idempotencyFingerprint: request.idempotencyFingerprint,
          recoveryMode: request.recoveryMode,
          transitionMode: request.transitionMode,
          lockBefore,
          leaseBefore: activeLease === null ? 'absent' : 'present',
          lockAction:
            request.transitionMode === 'already_completed'
              ? 'confirm_existing_completed'
              : request.resolution === 'completed'
                ? 'preserve_as_reconciled_completed'
                : 'release_after_confirmed_no_effect',
        },
      });
    }

    if (!alreadyApplied) {
      let transitioned: boolean;
      if (request.resolution === 'completed') {
        if (request.transitionMode === 'unknown_marker') {
          transitioned = await this.redis.compareAndSetWithLeaseMissingRequired(
            redisKey,
            leaseKey,
            receiptKey,
            unknownMarker,
            completedMarker,
          );
        } else if (request.transitionMode === 'expired_running_marker') {
          transitioned = await this.redis.compareAndSetWithLeaseMissingRequired(
            redisKey,
            leaseKey,
            receiptKey,
            runningMarker,
            completedMarker,
          );
        } else if (request.transitionMode === 'missing_marker') {
          transitioned =
            await this.redis.setStateIfMissingWithLeaseMissingRequired(
              redisKey,
              leaseKey,
              receiptKey,
              completedMarker,
            );
        } else {
          transitioned = false;
        }
      } else {
        const expectedState =
          request.transitionMode === 'unknown_marker'
            ? unknownMarker
            : request.transitionMode === 'expired_running_marker'
              ? runningMarker
              : undefined;
        const result = expectedState
          ? await this.redis.compareAndDeleteWithReceiptAndLeaseMissingRequired(
              redisKey,
              expectedState,
              leaseKey,
              receiptKey,
              releasedReceipt,
            )
          : await this.redis.setReceiptIfStateAndLeaseMissingRequired(
              redisKey,
              leaseKey,
              receiptKey,
              releasedReceipt,
            );
        transitioned = result !== 'mismatch';
      }
      if (!transitioned) {
        await this.runtimeEvents.emit({
          tenantId: request.tenantId,
          threadId: request.threadId,
          runId: request.runId ?? undefined,
          eventType: 'tool.reconciliation.failed',
          actor: request.operatorId,
          target: request.toolName,
          payload: {
            callId: request.callId,
            reconciliationId: request.reconciliationId,
            resolution: request.resolution,
            evidenceRef: request.evidenceRef,
            scopeFingerprint: request.scopeFingerprint,
            idempotencyFingerprint: request.idempotencyFingerprint,
            recoveryMode: request.recoveryMode,
            transitionMode: request.transitionMode,
            reason:
              'Redis marker transition was not confirmed; no tool was invoked.',
          },
        });
        throw new ConflictException(
          'Redis marker changed or could not be updated; no tool was invoked.',
        );
      }
    }

    const result = {
      status: 'reconciled' as const,
      callId: request.callId,
      reconciliationId: request.reconciliationId,
      resolution: request.resolution,
      transitionMode: request.transitionMode,
      scopeFingerprint: request.scopeFingerprint,
      idempotencyFingerprint: request.idempotencyFingerprint,
      idempotencyAction:
        request.transitionMode === 'already_completed'
          ? 'already_completed'
          : request.resolution === 'completed'
            ? 'permanently_blocked'
            : 'released_after_manual_resolution',
    };
    await this.runtimeEvents.emit({
      tenantId: request.tenantId,
      threadId: request.threadId,
      runId: request.runId ?? undefined,
      eventType: 'tool.reconciled',
      actor: request.operatorId,
      target: request.toolName,
      payload: {
        ...result,
        operatorId: request.operatorId,
        evidenceRef: request.evidenceRef,
        recoveryMode: request.recoveryMode,
        transitionMode: request.transitionMode,
        idempotencyState:
          request.transitionMode === 'already_completed'
            ? 'completed_marker_confirmed'
            : request.resolution === 'completed'
              ? 'reconciled_completed'
              : 'released_after_confirmed_no_effect',
      },
    });
    return result;
  }

  private async readCompletedReconciliation(
    event: RuntimeEvent,
    request: ReconciliationRequest,
    redisKey: string,
    leaseKey: string,
  ) {
    if (
      !this.eventMatchesScope(event, request) ||
      event.target !== request.toolName
    ) {
      throw new ConflictException(
        'Existing reconciliation event scope does not match.',
      );
    }
    const payload = this.asRecord(event.payload);
    const transitionMode = payload.transitionMode;
    if (
      transitionMode !== 'unknown_marker' &&
      transitionMode !== 'expired_running_marker' &&
      transitionMode !== 'missing_marker' &&
      transitionMode !== 'already_completed'
    ) {
      throw new ConflictException(
        'Existing reconciliation event has no valid transition mode.',
      );
    }
    request.transitionMode = transitionMode;
    if (
      payload.callId !== request.callId ||
      payload.operatorId !== request.operatorId ||
      payload.resolution !== request.resolution ||
      payload.evidenceRef !== request.evidenceRef ||
      payload.scopeFingerprint !== request.scopeFingerprint ||
      payload.idempotencyFingerprint !== request.idempotencyFingerprint ||
      payload.recoveryMode !== request.recoveryMode ||
      payload.transitionMode !== request.transitionMode
    ) {
      throw new ConflictException(
        'This tool call has already been reconciled with different evidence or outcome.',
      );
    }
    const reconciliationId = this.readRequiredText(
      payload.reconciliationId,
      'reconciliationId',
      64,
    );
    const receiptKey = `tool-execution:scope:{${request.scopeFingerprint}}:receipt:${request.idempotencyFingerprint}`;
    if (request.resolution === 'completed') {
      const marker = await this.redis.getRequired(redisKey);
      const activeLease = await this.redis.getRequired(leaseKey);
      const matchesReconciled =
        marker ===
        `reconciled:completed:${request.scopeFingerprint}:${reconciliationId}`;
      const matchesOriginalCompleted =
        request.transitionMode === 'already_completed' &&
        marker?.startsWith(
          `completed:${request.scopeFingerprint}:${request.idempotencyFingerprint}:`,
        );
      if (
        activeLease !== null ||
        (!matchesReconciled && !matchesOriginalCompleted)
      ) {
        throw new ConflictException(
          'Completed reconciliation event does not match the Redis marker.',
        );
      }
    } else {
      const receipt = await this.redis.getRequired(receiptKey);
      const current = await this.redis.getRequired(redisKey);
      const activeLease = await this.redis.getRequired(leaseKey);
      const originalMarker =
        request.transitionMode === 'unknown_marker'
          ? `unknown:${request.scopeFingerprint}:${request.idempotencyFingerprint}:${request.callId}`
          : request.transitionMode === 'expired_running_marker'
            ? `running:${request.scopeFingerprint}:${request.idempotencyFingerprint}:${request.callId}`
            : null;
      if (
        receipt !== `released:${request.resolution}:${reconciliationId}` ||
        (originalMarker !== null && current === originalMarker) ||
        (request.transitionMode !== 'missing_marker' &&
          request.transitionMode !== 'unknown_marker' &&
          request.transitionMode !== 'expired_running_marker') ||
        (activeLease !== null && current === originalMarker)
      ) {
        throw new ConflictException(
          'Release reconciliation event does not match the Redis receipt.',
        );
      }
    }
    return {
      status: 'reconciled' as const,
      callId: request.callId,
      reconciliationId,
      resolution: request.resolution,
      transitionMode: request.transitionMode,
      scopeFingerprint: request.scopeFingerprint,
      idempotencyFingerprint: request.idempotencyFingerprint,
      idempotencyAction:
        request.transitionMode === 'already_completed'
          ? 'already_completed'
          : request.resolution === 'completed'
            ? 'permanently_blocked'
            : 'released_after_manual_resolution',
    };
  }

  private async findCallEvents(
    tenantId: string,
    threadId: string,
    runId: string | undefined,
    callId: string,
  ): Promise<RuntimeEvent[]> {
    const found: RuntimeEvent[] = [];
    let beforeSequence: number | undefined;
    for (let pageIndex = 0; pageIndex < MAX_EVENT_PAGES; pageIndex += 1) {
      const page = (await this.runtimeEvents.list(
        threadId,
        runId,
        tenantId,
        beforeSequence,
        500,
      )) as RuntimeEvent[];
      if (page.length === 0) break;
      for (const event of page) {
        if (
          [
            'tool.call',
            'tool.result',
            'tool.unknown',
            'tool.failed',
            'tool.blocked',
            'tool.reconciliation.requested',
            'tool.reconciled',
          ].includes(event.eventType) &&
          this.asRecord(event.payload).callId === callId
        ) {
          found.push(event);
        }
      }
      if (page.length < 500) break;
      const oldestSequence = Math.min(...page.map((event) => event.sequence));
      if (!Number.isFinite(oldestSequence) || oldestSequence <= 0) break;
      beforeSequence = oldestSequence;
    }
    return found;
  }

  private parseInput(body: unknown): ToolReconciliationInput {
    const value = this.asRecord(body);
    const tenantId =
      value.tenantId === undefined || value.tenantId === null
        ? 'legacy'
        : this.readRequiredText(value.tenantId, 'tenantId', 64);
    const threadId = this.readRequiredText(value.threadId, 'threadId', 64);
    const runId =
      value.runId === undefined || value.runId === null
        ? undefined
        : this.readRequiredText(value.runId, 'runId', 64);
    const operatorId = this.readRequiredText(
      value.operatorId,
      'operatorId',
      64,
    );
    if (
      operatorId === 'admin-backend' ||
      this.containsControlCharacters(operatorId)
    ) {
      throw new BadRequestException(
        'operatorId must be injected by the authenticated Admin API user.',
      );
    }
    const evidenceRef = this.readRequiredText(
      value.evidenceRef,
      'evidenceRef',
      500,
    );
    if (this.containsControlCharacters(evidenceRef)) {
      throw new BadRequestException('evidenceRef contains control characters.');
    }
    const resolution = value.resolution;
    if (
      resolution !== 'completed' &&
      resolution !== 'not_applied' &&
      resolution !== 'compensated'
    ) {
      throw new BadRequestException(
        'resolution must be completed, not_applied, or compensated.',
      );
    }
    return { tenantId, threadId, runId, operatorId, evidenceRef, resolution };
  }

  private eventMatchesScope(
    event: RuntimeEvent,
    input: Pick<
      ResolvedToolReconciliationInput,
      'tenantId' | 'threadId' | 'runId'
    >,
  ) {
    return (
      event.tenantId === input.tenantId &&
      event.threadId === input.threadId &&
      event.runId === input.runId
    );
  }

  private readRequiredText(value: unknown, field: string, maxLength: number) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > maxLength
    ) {
      throw new BadRequestException(
        `${field} must be a non-empty string of at most ${maxLength} characters.`,
      );
    }
    return value.trim();
  }

  private containsControlCharacters(value: string) {
    for (const character of value) {
      const code = character.charCodeAt(0);
      if ((code >= 0 && code <= 0x1f) || code === 0x7f) return true;
    }
    return false;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private scopeFingerprint(
    tenantId: string,
    threadId: string,
    toolName: string,
    keyRef: string,
  ) {
    return createHash('sha256')
      .update(`${tenantId}\0${threadId}\0${toolName}\0${keyRef}`)
      .digest('hex');
  }

  private fingerprint(
    tenantId: string,
    threadId: string,
    runId: string | null,
    callId: string,
    toolName: string,
    keyRef: string,
  ) {
    return createHash('sha256')
      .update(
        `${tenantId}\0${threadId}\0${runId ?? ''}\0${callId}\0${toolName}\0${keyRef}`,
      )
      .digest('hex');
  }
}
