const en = require('./en.json');
const de = require('./de.json');
const translations = { en, de };
let currentLang = 'en';

function initLang() {
  const stored = localStorage.getItem('mapvs_language');
  if (stored && translations[stored]) currentLang = stored;
  else {
    const nav = navigator.language?.split('-')[0];
    if (translations[nav]) currentLang = nav;
  }
}

function setLang(lang) {
  if (translations[lang]) {
    currentLang = lang;
    localStorage.setItem('mapvs_language', lang);
  }
}

function t(key, params = {}) {
  let text = translations[currentLang]?.[key] || translations.en?.[key] || key;
  Object.entries(params).forEach(([k, v]) => {
    text = text.replace(`{${k}}`, v);
  });
  return text;
}

module.exports = { initLang, setLang, t, currentLang: () => currentLang };
