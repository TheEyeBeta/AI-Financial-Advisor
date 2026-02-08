import { execSync } from 'child_process';

type LintMessage = {
  ruleId: string | null;
  line: number;
  message: string;
};

type LintFileResult = {
  filePath: string;
  messages: LintMessage[];
};

function runHookAudit() {
  const lintOutput = execSync('npm run lint -- --format json', { encoding: 'utf8' });
  const results = JSON.parse(lintOutput) as LintFileResult[];

  const hookIssues = results.flatMap((file) =>
    file.messages
      .filter((msg) => msg.ruleId === 'react-hooks/exhaustive-deps')
      .map((msg) => ({
        file: file.filePath,
        line: msg.line,
        message: msg.message,
      })),
  );

  console.log(`Total hook dependency issues: ${hookIssues.length}`);

  const byFile = hookIssues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.file] = (acc[issue.file] || 0) + 1;
    return acc;
  }, {});

  console.log('\nFiles with most issues:');
  Object.entries(byFile)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .forEach(([file, count]) => console.log(`${count}\t${file}`));
}

runHookAudit();
