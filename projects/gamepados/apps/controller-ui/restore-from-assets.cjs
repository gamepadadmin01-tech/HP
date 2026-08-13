const fs = require('fs');

const savedPath = 'F:\\hlooo\\assets\\savedcode.txt';
const appPath = 'F:\\hlooo\\controller-ui\\src\\app\\App.tsx';

const savedLines = fs.readFileSync(savedPath, 'utf8').split('\n');
const appLines = fs.readFileSync(appPath, 'utf8').split('\n');

// 1. Find TabHome in savedcode.txt
const startIdx = savedLines.findIndex(l => l.startsWith('function TabHome'));
const endIdx = savedLines.findIndex(l => l.startsWith('function DashboardScreen'));

if (startIdx === -1 || endIdx === -1) {
  console.error("Could not find bounds in savedcode.txt!");
  process.exit(1);
}

const tabsContent = savedLines.slice(startIdx, endIdx).join('\n');

// 2. Find DashboardScreen in App.tsx
const appDashIdx = appLines.findIndex(l => l.startsWith('function DashboardScreen'));

if (appDashIdx === -1) {
  console.error("Could not find DashboardScreen in App.tsx!");
  process.exit(1);
}

// 3. Insert tabsContent before DashboardScreen
const newAppStr = [
  ...appLines.slice(0, appDashIdx),
  tabsContent,
  ...appLines.slice(appDashIdx)
].join('\n');

fs.writeFileSync(appPath, newAppStr, 'utf8');
console.log('Successfully restored tabs from savedcode.txt!');
