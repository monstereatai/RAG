#!/usr/bin/env node
import { Command } from 'commander';
import { ConfigStore } from './core/config-store.js';
import { registerAuthCommand } from './commands/auth.js';
import { registerAdminCommand } from './commands/admin.js';
import { registerAskCommand } from './commands/ask.js';
import { registerConfigCommand, registerInitCommand } from './commands/config.js';
import { registerContextCommand } from './commands/context.js';
import { registerDocCommand } from './commands/doc.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerEvalCommand } from './commands/eval.js';
import { registerGraphCommand } from './commands/graph.js';
import { registerSearchCommand } from './commands/search.js';
import { registerSkillCommand } from './commands/skill.js';
import { registerWorkflowCommand } from './commands/workflow.js';

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
registerWorkflowCommand(program, deps);
registerAdminCommand(program, deps);
registerGraphCommand(program, deps);
registerEvalCommand(program, deps);
registerDoctorCommand(program, deps);

await program.parseAsync(process.argv);
