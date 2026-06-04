#!/usr/bin/env node
import { ConfigError, loadConfig } from './config/index.js';

function configCheck(targetDir: string): number {
  try {
    const result = loadConfig(targetDir);
    console.log(`目标项目：${targetDir}`);
    console.log(`配置来源：${result.source}${result.configPath ? ` (${result.configPath})` : ''}`);
    for (const note of result.notes) console.log(`提示：${note}`);
    console.log('解析后的配置：');
    console.log(JSON.stringify(result.config, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`配置错误：${err.message}`);
      console.error(`怎么修：${err.hint}`);
      return 1;
    }
    throw err;
  }
}

function main(argv: string[]): number {
  const command = argv[0];
  const targetDir = argv[1] ?? process.cwd();

  switch (command) {
    case 'config:check':
      return configCheck(targetDir);
    default:
      console.error('用法：adw config:check [目标项目目录]');
      return 2;
  }
}

process.exit(main(process.argv.slice(2)));
