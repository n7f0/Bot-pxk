'use strict';

/**
 * Padrão visual dos painéis (descrições de embed):
 *  - h('Título')        -> cabeçalho de seção (###)
 *  - kv('Chave', 'valor') -> "**Chave:** valor"
 *  - muted('texto')     -> texto pequeno e discreto (-#)
 */
const h = (title) => `### ${title}`;
const kv = (key, value) => `**${key}:** ${value}`;
const muted = (text) => `-# ${text}`;

module.exports = { h, kv, muted };
