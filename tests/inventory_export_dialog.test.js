const fs = require('fs');
const vm = require('vm');

function element(initial = {}) {
  return {
    value: initial.value || '', checked: Boolean(initial.checked), hidden: Boolean(initial.hidden),
    options: [], dataset: initial.dataset || {}, listeners: {},
    classList: { add() {}, remove() {} },
    setAttribute() {}, appendChild(child) { this.options.push(child); },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    dispatchEvent(event) { if (this.listeners[event.type]) this.listeners[event.type](); },
  };
}

const elements = {
  'inventory-export-dialog': element(), 'inventory-export-year': element(),
  'inventory-export-month': element(), 'inventory-export-start': element(),
  'inventory-export-end': element(), 'inventory-export-month-mode': element(),
  'inventory-export-custom-mode': element(), 'inventory-export-all-sites': element(true),
  'inventory-export-month-fields': element(), 'inventory-export-custom-fields': element({ hidden: true }),
  'inventory-export-submit': element(),
};
const sites = ['office', 'warehouse', 'van', 'truck'].map(site => element({ checked: true, dataset: { site } }));
const sections = ['inventory', 'positions', 'alerts', 'movements'].map(section => element({ checked: section !== 'alerts', dataset: { section } }));
const documentStub = {
  getElementById(id) { return elements[id]; },
  querySelectorAll(selector) { return selector.includes('data-site') ? sites : (selector.includes('data-section') ? sections.filter(input => !selector.includes(':checked') || input.checked) : []); },
  createElement() { return element(); },
};
const context = { document: documentStub, Date, URLSearchParams, console, setTimeout };
vm.runInNewContext(fs.readFileSync('static/js/modals/inventory-export.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('static/js/site-label.js', 'utf8'), context);
if (context.inventorySiteLabel('office') !== '公司') throw new Error('office UI label mismatch');
if (context.inventorySiteLabel('warehouse') !== '倉庫') throw new Error('warehouse UI label mismatch');
if (context.inventorySiteLabel('custom location') !== 'custom location') throw new Error('custom location must remain unchanged');

context.openInventoryExportDialog();
const now = new Date();
if (String(elements['inventory-export-year'].value) !== String(now.getFullYear())) throw new Error('default year not initialized');
if (elements['inventory-export-month'].value !== String(now.getMonth() + 1).padStart(2, '0')) throw new Error('default month not initialized');
if (!elements['inventory-export-month-mode'].checked || elements['inventory-export-custom-mode'].checked) throw new Error('default radio state invalid');
if (!sections[0].checked || !sections[1].checked || sections[2].checked || !sections[3].checked) throw new Error('default export sections invalid');
if (elements['inventory-export-month-fields'].hidden || !elements['inventory-export-custom-fields'].hidden) throw new Error('default visibility invalid');

elements['inventory-export-custom-mode'].checked = true;
elements['inventory-export-custom-mode'].dispatchEvent({ type: 'change' });
if (!elements['inventory-export-month-fields'].hidden || elements['inventory-export-custom-fields'].hidden) throw new Error('custom visibility invalid');
context.closeInventoryExportDialog();
context.openInventoryExportDialog();
if (!elements['inventory-export-month-mode'].checked || elements['inventory-export-custom-mode'].checked) throw new Error('reopen radio state invalid');
if (sections[2].checked) throw new Error('alerts must remain unselected on reopen');
if (elements['inventory-export-month-fields'].hidden || !elements['inventory-export-custom-fields'].hidden) throw new Error('reopen visibility invalid');
console.log('inventory export dialog runtime ok');
