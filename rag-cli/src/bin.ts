#!/usr/bin/env node
import { Command } from 'commander';
import { ConfigStore } from './core/config-store.js';
import { registerAuthCommand } from './commands/auth.js';
import { registerAskCommand } from './commands/ask.js';
import { registerConfigCommand, registerInitCommand } from './commands/config.js';
import { registerContextCommand } from './commands/context.js';
import { registerDocCommand } from './commands/doc.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerSearchCommand } from './commands/search.js';
import { registerSkillCommand } from './commands/skill.js';

const program = new Command();
const deps = {
  configStore: new ConfigStore(),
};

program
  .name('rag')
  .description('RAG knowledge CLI')
  .version('0.1.0')
  .showHelpAfterError();

registerInitCommand(program, deps);
registerAuthCommand(program, deps);
registerConfigCommand(program, deps);
registerSearchCommand(program, deps);
registerAskCommand(program, deps);
registerContextCommand(program, deps);
registerSkillCommand(program, deps);
registerDocCommand(program, deps);
registerDoctorCommand(program, deps);

await program.parseAsync(process.argv);

