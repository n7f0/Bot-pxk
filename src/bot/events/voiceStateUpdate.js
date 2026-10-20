const { onVoiceUpdate } = require('../voiceTracker');

module.exports = (client) => {
  client.on('voiceStateUpdate', (oldState, newState) => {
    onVoiceUpdate(client, oldState, newState).catch((e) => console.error('[voice]', e));
  });
};