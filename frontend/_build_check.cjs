const { spawn } = require('child_process');
const fs = require('fs');

const logFile = fs.createWriteStream('d:/A/Projects/VirtAI-Project/frontend/build_result.log', { flags: 'w' });

const child = spawn('node', ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: 'd:/A/Projects/VirtAI-Project/frontend',
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
});

child.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text);
  logFile.write(text);
});

child.stderr.on('data', (data) => {
  const text = data.toString();
  process.stderr.write(text);
  logFile.write('[STDERR] ' + text);
});

child.on('close', (code) => {
  const msg = `\nBUILD EXIT CODE: ${code}\n`;
  process.stdout.write(msg);
  logFile.write(msg);
  logFile.end();
});

child.on('error', (err) => {
  const msg = `\nSPAWN ERROR: ${err.message}\n`;
  process.stderr.write(msg);
  logFile.write(msg);
  logFile.end();
});
