import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatDto } from './chat.dto';
import type { ChatResponse } from './chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  chat(@Body() body: ChatDto): Promise<ChatResponse> {
    return this.chatService.chat(body);
  }
}
