import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

export async function promptInput(message: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = await question(`${message}${suffix}: `);
  return answer || defaultValue || '';
}

export async function promptSecret(message: string): Promise<string> {
  return question(`${message}: `, true);
}

function question(query: string, secret = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input,
      output,
      terminal: true,
    }) as readline.Interface & {
      muted?: boolean;
      _writeToOutput?: (value: string) => void;
    };

    if (secret) {
      rl.muted = true;
      const originalWrite = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = (value: string) => {
        if (rl.muted && value !== '\n' && value !== '\r\n') {
          output.write('*');
          return;
        }
        originalWrite?.(value);
      };
    }

    rl.question(query, (answer) => {
      rl.close();
      if (secret) {
        output.write('\n');
      }
      resolve(answer.trim());
    });
  });
}
