#!/usr/bin/env node
/**
 * One entry point, four verbs.
 *
 *   record    an LLM discovers a flow and saves a capability artifact
 *   replay    run a saved artifact with no model in the decision loop
 *   catalog   list saved capabilities and their typed contracts
 *   operator  serve the human handoff surface
 */
import { Command } from 'commander';
import { config } from './config.js';

const program = new Command();

program
  .name('cuas')
  .description('Computer-use automation: discover once, replay deterministically.')
  .version('0.1.0');

program
  .command('record')
  .description('Run the LLM discovery loop against a live surface and save a capability.')
  .requiredOption('-g, --goal <goal>', 'the goal, in natural language')
  .option('-u, --url <url>', 'entry point of the target application', config.targetUrl)
  .option('-o, --out <file>', 'where to write the capability artifact')
  .option('--max-steps <n>', 'stopping condition', '30')
  .action(() => {
    throw new Error('not implemented yet: discovery loop lands in Phase 5');
  });

program
  .command('replay')
  .description('Replay a saved capability with typed inputs. No LLM involved.')
  .requiredOption('-c, --capability <file>', 'path to the capability artifact')
  .option('-i, --input <key=value...>', 'input parameters', [])
  .option('--fault <name>', 'ask the local target app to inject a fault')
  .action(() => {
    throw new Error('not implemented yet: replay engine lands in Phase 4');
  });

program
  .command('catalog')
  .description('List saved capabilities as typed, callable contracts.')
  .action(() => {
    throw new Error('not implemented yet: catalog lands in Phase 10');
  });

program
  .command('operator')
  .description('Serve the operator surface for human takeover of a live session.')
  .option('-p, --port <port>', 'port', String(config.operatorPort))
  .action(() => {
    throw new Error('not implemented yet: handoff lands in Phase 8');
  });

program.parseAsync(process.argv);
