export async function openTools(page) {
  await page.getByRole('navigation', {name:'Workspace', exact:true}).waitFor({state:'visible'});
  if (await page.locator('.notebook-nav-row--simple').count()) {
    await page.getByRole('navigation', {name:'Workspace', exact:true}).getByRole('button', {name:'Notebook', exact:true}).click();
    await page.getByRole('navigation', {name:'Workspace', exact:true}).getByRole('button', {name:'Tools', exact:true}).click();
    return;
  }
  const menu = page.locator('.notebook-map-tools');
  if (!(await menu.evaluate(el => el.open))) await menu.locator(':scope > summary').click();
}

export async function mapCommand(page, name) {
  await openTools(page);
  await page.getByRole('button', { name, exact: true }).click();
  const menu = page.locator('.notebook-map-tools');
  if (await menu.count() && await menu.evaluate(el => el.open)) await menu.locator(':scope > summary').click();
}

export async function notebookSection(page, mode) {
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Notebook', exact: true }).click();
  if (await page.locator('.memo-workflow-notebook').count()) {
    if (mode === 'review' && await page.locator('.workflow-notes').count() && !await page.locator('.workflow-notes').evaluate(el=>el.open)) await page.locator('.workflow-notes > summary').click();
    return;
  }
  await page.getByRole('combobox', { name: 'Notebook section' }).selectOption(mode);
}

export async function showMap(page) {
  if (await page.locator('.notebook-nav-row--simple').count()) {
    const hide=page.getByRole('button',{name:'Hide sidebar',exact:true});
    if(await hide.isVisible())await hide.click();
    return;
  }
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Map', exact: true }).click();
}

export async function editSelected(page) {
  const notebook=page.getByRole('complementary',{name:'Notebook',exact:true});
  if (await notebook.isVisible()) return;
  const edit = page.getByRole('button', {name:'Edit',exact:true});
  await edit.waitFor({state:'visible'});
  await edit.click();
}

export async function projectMenu(page, action) {
  const menu = page.locator('.project-menu');
  if (!(await menu.evaluate(el => el.open))) await menu.locator(':scope > summary').click();
  await menu.getByRole('button', { name: action, exact: true }).click();
}

export async function preferences(page) {
  const menu = page.locator('.project-menu');
  if (!(await menu.evaluate(el => el.open))) await menu.locator(':scope > summary').click();
  const disclosure = menu.locator('details');
  if (!(await disclosure.evaluate(el => el.open))) await disclosure.locator('summary').click();
}
