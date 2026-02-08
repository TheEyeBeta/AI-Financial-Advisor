import { execSync } from 'node:child_process';

interface LintMessage {
  ruleId: string | null;
  line: number;
  message: string;
}

interface LintResult {
  filePath: string;
  messages: LintMessage[];
}

function runHookAudit() {
  const output = execSync('npx eslint . --ext ts,tsx --format json', {
    encoding: 'utf8',
  });

  const results = JSON.parse(output) as LintResult[];

  const hookIssues = results.flatMap((file) =>
    file.messages
      .filter((message) => message.ruleId === 'react-hooks/exhaustive-deps')
      .map((message) => ({
        file: file.filePath,
        line: message.line,
        message: message.message,
      }))
  );

  console.log(`Total hook dependency issues: ${hookIssues.length}`);

  const byFile = hookIssues.reduce<Record<string, number>>((accumulator, issue) => {
    accumulator[issue.file] = (accumulator[issue.file] || 0) + 1;
    return accumulator;
  }, {});

  console.log('\nFiles with most issues:');
  Object.entries(byFile)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .forEach(([file, count]) => {
      console.log(`${count}\t${file}`);
    });
}

runHookAudit();
