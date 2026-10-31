import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { LlmProvider } from '../../providers/llm/llm.provider';

@Injectable()
export class LlmRequestBudgetInterceptor implements NestInterceptor {
  constructor(private readonly llmProvider: LlmProvider) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return new Observable((subscriber) =>
      this.llmProvider.runWithRequestBudget(() =>
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        }),
      ),
    );
  }
}
