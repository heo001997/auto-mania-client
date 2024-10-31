const concurrently = require('concurrently');
const path = require('path');

concurrently([
  {
    command: 'node server.js',
    name: 'terminal-command-runner',
    cwd: path.resolve(__dirname, './terminal-command-runner'),
    prefixColor: 'blue'
  },
  {
    command: 'npm run start',
    name: 'ws-scrcpy',
    cwd: path.resolve(__dirname, './ws-scrcpy'),
    prefixColor: 'green'
  }
], {
  prefix: 'name',
  killOthers: ['failure', 'success'],
  restartTries: 3,
}).result.then(
  () => console.log('All processes exited successfully'),
  (error) => console.error('One or more processes failed', error)
);