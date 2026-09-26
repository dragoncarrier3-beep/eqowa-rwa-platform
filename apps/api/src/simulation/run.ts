import { loadEnv } from '../bootstrap.ts';

import { createContext, type SimNetwork } from './context.ts';
import { writeReport } from './report.ts';
import { runScenario } from './scenario.ts';

/** Runs the lifecycle against an existing deployment and writes the report. */
export async function simulate(network: SimNetwork) {
  const ctx = createContext(network);
  console.log(`Simulating on ${network}, run ${ctx.runId}`);
  const result = await runScenario(ctx, (line) => console.log(line));
  const paths = await writeReport(result);
  console.log('');
  console.log(`${result.passed} of ${result.steps.length} steps passed`);
  console.log(`Report: ${paths.markdown}`);
  ctx.provider.destroy();
  return result;
}

function networkArg(): SimNetwork {
  const index = process.argv.indexOf('--network');
  const value = index === -1 ? 'localhost' : process.argv[index + 1];
  if (value !== 'localhost' && value !== 'amoy') {
    throw new Error('--network must be localhost or amoy');
  }
  return value;
}

if (process.argv[1]?.endsWith('run.ts')) {
  loadEnv();
  simulate(networkArg())
    .then((result) => {
      process.exitCode = result.failed === 0 ? 0 : 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
