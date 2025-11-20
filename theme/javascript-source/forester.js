import 'ninja-keys';
import 'katex';

import autoRenderMath from 'katex/contrib/auto-render';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import lean from '../../highlight/lean';

const REGISTERED_LANGS = [
 ['lean', lean],
 ['javascript', javascript],
 ['js', javascript],
 ['typescript', typescript],
 ['ts', typescript],
 ['python', python],
 ['py', python],
 ['bash', bash],
 ['sh', bash],
 ['json', json],
 ['xml', xml],
 ['html', xml],
];

REGISTERED_LANGS.forEach(([name, lang]) => {
 try {
  hljs.registerLanguage(name, lang);
 } catch (err) {
  console.warn('Failed to register language', name, err);
 }
});

const stripLeadingNewline = (block) => {
 const text = block.textContent ?? '';
 if (text.startsWith('\r\n')) {
  block.textContent = text.slice(2);
 } else if (text.startsWith('\n')) {
  block.textContent = text.slice(1);
 }
};

const highlightCodeBlocks = () => {
 document.querySelectorAll('pre code').forEach((block) => {
  if (block.dataset.highlighted === 'true') {
   return;
  }
  stripLeadingNewline(block);
  try {
   hljs.highlightElement(block);
   block.dataset.highlighted = 'true';
  } catch (err) {
   console.warn('Highlight error', err);
  }
 });
};

function partition(array, isValid) {
 return array.reduce(([pass, fail], elem) => {
  return isValid(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]];
 }, [[], []]);
}

const THEME_KEY = 'forester-theme';

const applyTheme = (theme) => {
 document.body?.setAttribute('data-theme', theme);
 const icon = document.querySelector('#theme-toggle .theme-toggle__icon');
 if (icon) {
  icon.textContent = theme === 'dark' ? '☀︎' : '☾';
 }
};

const getStoredTheme = () => {
 try {
  return localStorage.getItem(THEME_KEY);
 } catch {
  return null;
 }
};

const storeTheme = (theme) => {
 try {
  localStorage.setItem(THEME_KEY, theme);
 } catch {
  /* ignore */
 }
};

// const KATEX_IGNORED_TAGS = ["script", "noscript", "style", "textarea"];

window.addEventListener("load", (event) => {
//  autoRenderMath(document.body, {
//   ignoredTags: KATEX_IGNORED_TAGS,
//  });
 highlightCodeBlocks();

 const themeToggle = document.getElementById('theme-toggle');
 let prefersDark;
 try {
  prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
 } catch {
  prefersDark = null;
 }
 const storedTheme = getStoredTheme();
 const systemTheme = prefersDark && prefersDark.matches ? 'dark' : 'light';
 const initialTheme = storedTheme || systemTheme;
 applyTheme(initialTheme);

 if (themeToggle) {
  themeToggle.addEventListener('click', () => {
   const nextTheme = document.body?.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
   applyTheme(nextTheme);
   storeTheme(nextTheme);
  });
 }

 if (prefersDark?.addEventListener) {
  prefersDark.addEventListener('change', (evt) => {
   if (!getStoredTheme()) {
    applyTheme(evt.matches ? 'dark' : 'light');
   }
  });
 } else if (prefersDark?.addListener) {
  prefersDark.addListener((evt) => {
   if (!getStoredTheme()) {
    applyTheme(evt.matches ? 'dark' : 'light');
   }
  });
 }

 const openAllDetailsAbove = elt => {
  while (elt != null) {
   if (elt.nodeName == 'DETAILS') {
    elt.open = true
   }

   elt = elt.parentNode;
  }
 }

 const jumpToSubtree = evt => {
  if (evt.target.tagName === "A") {
   return;
  }

  const link = evt.target.closest('span[data-target]')
  const selector = link.getAttribute('data-target')
  const tree = document.querySelector(selector)
  openAllDetailsAbove(tree)
  window.location = selector
 }


 [...document.querySelectorAll("[data-target^='#']")].forEach(
  el => el.addEventListener("click", jumpToSubtree)
 );
});

const ninja = document.querySelector('ninja-keys');

fetch("./forest.json")
 .then((res) => res.json())
 .then((data) => {
  const items = []

  const editIcon = '<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20"><path d="M480-120v-71l216-216 71 71-216 216h-71ZM120-330v-60h300v60H120Zm690-49-71-71 29-29q8-8 21-8t21 8l29 29q8 8 8 21t-8 21l-29 29ZM120-495v-60h470v60H120Zm0-165v-60h470v60H120Z"/></svg>'
  const bookmarkIcon = '<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20"><path d="M120-40v-700q0-24 18-42t42-18h480q24 0 42.5 18t18.5 42v700L420-167 120-40Zm60-91 240-103 240 103v-609H180v609Zm600 1v-730H233v-60h547q24 0 42 18t18 42v730h-60ZM180-740h480-480Z"/></svg>'

  if (window.sourcePath) {
   items.push({
    id: 'edit',
    title: 'Edit current tree in Visual Studio Code',
    section: 'Commands',
    hotkey: 'cmd+e',
    icon: editIcon,
    handler: () => {
     window.location.href = `vscode://file/${window.sourcePath}`
    }
   })
  }

  const isTopTree = (addr) => {
   const item = data[addr]
   return item.tags ? item.tags.includes('top') : false
  }

  const addItemToSection = (addr, section, icon) => {
   const item = data[addr]
   const title =
    item.taxon
     ? (item.title ? `${item.taxon}. ${item.title}` : item.taxon)
     : (item.title ? item.title : "Untitled")
   const fullTitle = `${title} [${addr}]`
   items.push({
    id: addr,
    title: fullTitle,
    section: section,
    icon: icon,
    handler: () => {
     window.location.href = item.route
    }
   })
  }

  const [top, rest] = partition(Object.keys(data), isTopTree)
  top.forEach((addr) => addItemToSection(addr, "Top Trees", bookmarkIcon))
  rest.forEach((addr) => addItemToSection(addr, "All Trees", null))

  ninja.data = items
 });


