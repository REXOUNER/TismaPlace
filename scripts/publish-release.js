const fs = require('fs');
const path = require('path');

const owner = 'REXOUNER';
const repo = 'TismaPlace';
const version = require('../package.json').version;
const tag = process.env.GITHUB_REF_NAME || 'v' + version;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const apiBase = 'https://api.github.com/repos/' + owner + '/' + repo;

if (!token) throw new Error('GH_TOKEN is required to publish a release.');
if (tag !== 'v' + version) throw new Error('Tag ' + tag + ' must match package version ' + version + '.');

const setupName = 'Tisma-Place-Setup-' + version + '-x64.exe';
const files = [setupName, setupName + '.blockmap', 'latest.yml'].map(name => ({
  name,
  path: path.join(__dirname, '..', 'dist', name)
}));

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Tisma-Place-release',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error('GitHub API returned HTTP ' + response.status + ': ' + detail.slice(0, 400));
  }
  return response.status === 204 ? null : response.json();
}

async function main() {
  for (const file of files) {
    if (!fs.existsSync(file.path)) throw new Error('Required release file is missing: ' + file.path);
  }
  const manifest = fs.readFileSync(files[2].path, 'utf8');
  if (!manifest.includes(setupName)) throw new Error('latest.yml does not point to ' + setupName + '.');

  let release;
  try {
    release = await request(apiBase + '/releases/tags/' + encodeURIComponent(tag));
  } catch (error) {
    if (!error.message.includes('HTTP 404')) throw error;
    release = await request(apiBase + '/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: 'Tisma Place ' + version, draft: false, prerelease: false, generate_release_notes: true })
    });
  }

  for (const asset of release.assets || []) {
    if (!files.some(file => file.name === asset.name)) continue;
    await request(apiBase + '/releases/assets/' + asset.id, { method: 'DELETE' });
    console.log('Removed previous asset: ' + asset.name);
  }

  for (const file of files) {
    const size = fs.statSync(file.path).size;
    const uploadUrl = 'https://uploads.github.com/repos/' + owner + '/' + repo + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(file.name);
    const body = fs.createReadStream(file.path);
    const result = await request(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
      body,
      duplex: 'half'
    });
    if (result.size !== size) throw new Error('Uploaded size mismatch for ' + file.name + '.');
    console.log('Published ' + result.name + ' (' + result.size + ' bytes).');
  }

  const finalRelease = await request(apiBase + '/releases/tags/' + encodeURIComponent(tag));
  const published = new Map((finalRelease.assets || []).map(asset => [asset.name, asset.size]));
  for (const file of files) {
    if (published.get(file.name) !== fs.statSync(file.path).size) throw new Error('Release verification failed for ' + file.name + '.');
  }
  console.log('Release ' + tag + ' is complete and verified.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
