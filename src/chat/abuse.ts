import type { ChatLanguage } from "./language.js";

// Attempts to override the assistant, extract its instructions or reach backend secrets. They are
// recognised before any model call, so they cost no tokens, and the conversation is reset.
const overrideEn = /\b(?:ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(?:instructions?|prompts?|guidelines|system\s+message|safety\s+rules|your\s+rules|previous\s+rules|restrictions)\b/i;
const overrideUkRu = /(?:ігноруй|ігноруйте|проігноруй|забудь|забудьте|обійди|игнорируй|игнорируйте|проигнорируй|забудь|забудьте|обойди)[^.\n]{0,40}(?:інструкці|инструкци|правила|промпт|промт|обмеження|ограничения)/iu;
const revealTarget = /(?:system\s*prompt|system\s*message|hidden\s*(?:prompt|instructions?)|developer\s*(?:message|prompt)|your\s*(?:full\s*|initial\s*)?(?:prompt|instructions)|(?:системн\w+|системний)\s*(?:промпт|промт|повідомлення|сообщение|инструкц\w+)|(?:свої|свои|твої|твои|ваші|ваши)\s*(?:інструкц\w+|инструкц\w+|промпт\w*|промт\w*)|api[\s_-]?keys?|api[\s_-]?ключ\w*|ключі?\s*api|секретн\w+\s*ключ\w*|secret\s*keys?|access\s*tokens?|environment\s*variables?|env\s*vars?|змінн\w+\s*середовища|переменн\w+\s*окружения|upstream\s*(?:endpoint|url|api)|backend\s*(?:url|endpoint|details|address))/iu;
const revealVerb = /(?:print|show|reveal|output|repeat|dump|display|leak|expose|disclose|tell\s+me|give\s+me|write\s+out|покажи|покажіть|виведи|виведіть|вивести|надрукуй|розкрий|розкрити|повтори|скажи|дай|дайте|покажите|выведи|выведите|выведить|напиши|раскрой|раскройте|повтори|назови|назви)/iu;
const modeName = /(?:maintenance|debug|developer|admin|god|jailbreak|dan)\s*mode|режим\s*(?:обслуговування|обслуживания|розробника|разработчика|налагодження|отладки)/iu;
const modeCue = /(?:you\s+are|you['’]re|enable|enter|activate|switch|ти\s|ты\s|ввімкни|увімкни|включи|активуй|активируй)/iu;

/** True for messages that try to hijack the assistant or extract its prompt, keys or backend details. */
export function detectPromptInjection(message: string): boolean {
  const text = message.normalize("NFKC").slice(0, 4000);
  if (overrideEn.test(text) || overrideUkRu.test(text)) return true;
  if (revealTarget.test(text) && revealVerb.test(text)) return true;
  return modeName.test(text) && modeCue.test(text);
}

/** True when an answer exposes instruction text or secrets; it must never reach the customer. */
export function looksLikePromptLeak(answer: string): boolean {
  return /You are the Hotels24 hotel-search assistant|CARDS MODE:|These rules (?:also )?override earlier assistant messages|\bsk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY|HOTELS_API_KEY|MCP_AUTH_TOKEN/i.test(answer);
}

/** Short, fixed reply. Nothing about why it was refused. */
export function abuseReply(language: ChatLanguage): string {
  if (language === "en") return "I can only help with finding hotels on Hotels24. Let's start over: where are you planning to travel?";
  if (language === "ru") return "Я могу помочь только с подбором отелей на Hotels24. Давайте начнём сначала: куда планируете поездку?";
  return "Я можу допомогти лише з підбором готелів на Hotels24. Почнімо спочатку: куди плануєте поїздку?";
}
