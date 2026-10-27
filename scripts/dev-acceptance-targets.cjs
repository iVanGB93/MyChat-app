// Optional explicit Dev-only pair; default preserves the emulator test workflow.
async function acceptanceTargets(ids = process.argv.slice(2)) {
  const all = (await (await fetch('http://127.0.0.1:8081/json/list')).json())
    .filter(t => t.appId === 'com.axonic.dev');
  const targets = ids.length ? ids.map(id => all.find(t => t.id === id))
    : all.filter(t => t.deviceName.startsWith('sdk_gphone'));
  if (targets.length !== 2 || targets.some(t => !t) || targets[0].id === targets[1].id)
    throw Error('Exactly two distinct connected Dev targets required');
  return targets;
}
module.exports = { acceptanceTargets };
