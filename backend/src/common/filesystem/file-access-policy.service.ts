import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';

export interface FileAccessDecision {
  allowed: boolean;
  normalizedPath: string;
  reason?: string;
}

@Injectable()
export class FileAccessPolicyService {
  private readonly allowedRoots: string[];
  private readonly deniedSegments = new Set([
    '.env',
    '.git',
    '.history',
    'agent-course',
    'node_modules',
  ]);

  constructor(private readonly config: ConfigService) {
    const uploadDir =
      config.get<string>('workspace.uploadDir') ??
      path.resolve(process.cwd(), '../workspace/uploads');
    const workspaceRoot = path.dirname(uploadDir);
    this.allowedRoots = [this.normalize(workspaceRoot)];
  }

  validate(targetPath: string): FileAccessDecision {
    if (!targetPath || targetPath.includes('\0')) {
      return {
        allowed: false,
        normalizedPath: targetPath,
        reason: 'path is empty or invalid',
      };
    }

    const normalizedPath = this.normalize(
      path.isAbsolute(targetPath)
        ? targetPath
        : path.resolve(this.allowedRoots[0], targetPath),
    );

    if (!this.isInsideAllowedRoot(normalizedPath)) {
      return {
        allowed: false,
        normalizedPath,
        reason: 'path is outside allowed workspace roots',
      };
    }

    const deniedSegment = this.findDeniedSegment(normalizedPath);
    if (deniedSegment) {
      return {
        allowed: false,
        normalizedPath,
        reason: `path contains denied segment: ${deniedSegment}`,
      };
    }

    return {
      allowed: true,
      normalizedPath,
    };
  }

  assertAllowed(targetPath: string): string {
    const decision = this.validate(targetPath);
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }
    return decision.normalizedPath;
  }

  getAllowedRoots(): string[] {
    return [...this.allowedRoots];
  }

  private isInsideAllowedRoot(normalizedPath: string): boolean {
    return this.allowedRoots.some((root) => {
      const relative = path.relative(root, normalizedPath);
      return (
        relative === '' ||
        (!relative.startsWith('..') && !path.isAbsolute(relative))
      );
    });
  }

  private findDeniedSegment(normalizedPath: string): string | null {
    const segments = normalizedPath.split(path.sep).filter(Boolean);
    return segments.find((segment) => this.deniedSegments.has(segment)) ?? null;
  }

  private normalize(inputPath: string): string {
    return path.resolve(inputPath);
  }
}
