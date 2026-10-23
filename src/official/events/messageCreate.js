'use strict';

const { Events } = require('discord.js');
const tracker = require('../bateponto/tracker');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    await tracker.onMessage(message);
  },
};
