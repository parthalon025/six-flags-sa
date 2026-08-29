/**
 * The tour: which screens the twin photographs, and how it gets to each one.
 *
 * A navigation script is the one part of a screenshot tool that cannot be
 * derived — somebody has to say "tap this, then that". What CAN be derived is
 * the *shape* of the tour, and it is: Settings' topics and Plan's sections are
 * read out of the components that declare them, so a sixth Settings topic is
 * photographed by the next capture without anyone editing this file. That is
 * the difference between a tour that decays and one that does not.
 *
 * Everything else here is movement, not data. No Place name, count or party
 * code is written in this file: where a screen needs a Place, the tour opens
 * whichever Place the app itself listed first.
 *
 * Interface:
 *   screenPlan(index) → [{ id, title, intent, settle?, reach(page, ctx) }]
 *   settingsTopics(index) / planSections(index)
 */
import { dismissNavigation, go, root, until } from '../../../test/app/browser.mjs';

/**
 * Settings' topics, read from the `TOPICS` table SettingsPanel declares.
 *
 * The panel builds its tab strip by mapping over that array, so the array is
 * the list of Settings screens by construction — there is no second place a
 * topic could be added. Both the id and the label come from it; the label is
 * the app's own word for the topic and is never retyped here.
 */
export function settingsTopics(index) {
  const src = index.read('apps/party-tracker/components/SettingsPanel.jsx');
  const block = src.slice(src.indexOf('const TOPICS'), src.indexOf('];', src.indexOf('const TOPICS')));
  const topics = [...block.matchAll(/\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'\s*\}/g)].map(
    (m) => ({ id: m[1], label: m[2] }),
  );
  if (!topics.length) {
    throw new Error(
      'design-twin: SettingsPanel.jsx no longer declares a TOPICS array of { id, label } — ' +
        'the Settings half of the tour is derived from it, so fix the reader rather than ' +
        'writing the topics down here.',
    );
  }
  return topics;
}

/**
 * Plan's two sections, read from the `setSection` calls PlanPanel's tab strip
 * makes. The label is deliberately NOT parsed: PlanPanel writes it as JSX with
 * a count spliced in (`Stops{stopCount ? ` (${stopCount})` : ''}`), so the only
 * honest label is the one the browser paints, and the tour reads it off the
 * live tab at capture time.
 */
export function planSections(index) {
  const src = index.read('apps/party-tracker/components/PlanPanel.jsx');
  /* Anchored to the tab strip, not to the file. `setSection` is also called by
     the effect that jumps to Heights when a height card asks for it, and that
     call sits ABOVE the strip — reading the whole file returns the sections in
     an order the tab strip does not paint, and the tour then clicks the wrong
     tab and files the shot under the wrong name. The strip is the only place
     the order is the rendered order. */
  const strip = src.indexOf('className="settingsTopics"');
  const block = strip === -1 ? '' : src.slice(strip, src.indexOf('</div>', strip));
  const ids = [...new Set([...block.matchAll(/setSection\('([a-z]+)'\)/g)].map((m) => m[1]))];
  if (!ids.length) {
    throw new Error(
      'design-twin: PlanPanel.jsx no longer builds a `settingsTopics` strip of setSection(…) ' +
        'buttons — the Plan half of the tour is derived from it, so fix the reader rather than ' +
        'writing the sections down here.',
    );
  }
  return ids;
}

/* ------------------------------------------------------------------
   Movement helpers
   ------------------------------------------------------------------ */

/**
 * Park the sheet at one of its detents.
 *
 * `test/app/browser.mjs` exports `ensurePeek` and nothing for the other stops,
 * and the tour needs `full` for every screen that lives below the fold. Driven
 * through the resize slider's own keyboard contract — Home is shut, End is full
 * — so this is the app's affordance rather than a class being forced on.
 */
async function setSheet(page, stop) {
  const slider = page.getByRole('slider', { name: /Resize panel/ }).first();
  /* Visibility, not presence. The slider stays in the tree while the walking
     chrome is over the sheet, so a count of 1 is not a promise that it can be
     driven — and `press` on an unactionable element burns thirty seconds
     before saying so. */
  if (!(await slider.isVisible().catch(() => false))) return;
  if (stop === 'full' || stop === 'shut') {
    await slider.press(stop === 'full' ? 'End' : 'Home', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(450);
    return;
  }
  for (let i = 0; i < 8; i += 1) {
    const cls = (await page.locator('.sheet').getAttribute('class').catch(() => '')) || '';
    if (cls.split(/\s+/).includes(stop)) return;
    await slider.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

/**
 * Put the phone back where any screen can be reached from.
 *
 * The tour photographs the walking chrome, and walking is a mode: the route
 * preview sits over the sheet and the sheet's own resize control stops being
 * driveable underneath it. `dismissNavigation` in the harness ends a walk that
 * has started, but it knows nothing about the preview that precedes one — so
 * the tour cancels the preview the way a guest would, then hands over.
 *
 * Called before every screen rather than after the one that causes it: a
 * teardown that only runs on the happy path is a teardown that does not run.
 */
async function neutral(page) {
  const cancel = page.locator('.previewLink:has-text("Cancel"), .routePreview button:has-text("Cancel")');
  if (await cancel.count()) await cancel.first().click({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await dismissNavigation(page).catch(() => {});
  await root(page).catch(() => {});
  await page.waitForTimeout(200);
}

/** Wait for a selector to be on screen, or say which screen never arrived. */
async function present(page, selector, label, timeout = 15000) {
  await until(async () => (await page.locator(selector).count()) > 0, { timeout, label }).catch(() => {
    throw new Error(`${label} never appeared (${selector})`);
  });
}

/** Open whichever Place the app listed first — never one this file names. */
async function openFirstPlace(page) {
  await go(page, 'Places');
  await setSheet(page, 'full');
  const row = page.locator('.poiRow .poiMain').first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  if (!(await page.locator('.poiRow.open').count())) await row.click();
  await page.waitForTimeout(500);
  if (!(await page.locator('.poiRow.open .placeActions').count())) await row.click();
  await page.waitForTimeout(400);
  await present(page, '.poiRow.open', 'the opened Place');
}

/* ------------------------------------------------------------------
   The plan
   ------------------------------------------------------------------ */

export function screenPlan(index) {
  const plan = [
    {
      id: 'explore-resting',
      title: 'Explore — resting',
      intent: 'The screen the app opens on: the map, and the sheet at its resting stop.',
      reach: async (page) => {
        await go(page, 'Explore');
        await setSheet(page, 'peek');
      },
    },
    {
      id: 'explore-browse',
      title: 'Explore — browse list',
      intent: 'The same screen with the sheet pulled up: search, the category chips and the list.',
      reach: async (page) => {
        await go(page, 'Explore');
        await setSheet(page, 'full');
        await present(page, '.poiList', 'the browse list');
      },
    },
    {
      id: 'place-detail',
      title: 'Place detail',
      intent: 'One Place opened out of the list — whichever one the app listed first.',
      reach: openFirstPlace,
    },
    {
      id: 'walking',
      title: 'Walking chrome',
      intent: 'What the map wears while it is taking somebody somewhere.',
      settle: 1400,
      reach: async (page) => {
        await openFirstPlace(page);
        const walk = page.locator('.poiRow.open button[aria-label="Walk me there"]');
        if (!(await walk.count())) throw new Error('the opened Place offered no "Walk me there"');
        await walk.click();
        await present(page, '.routePreview, .navBanner, .navBar', 'the walking chrome');
      },
    },
    ...planSections(index).map((section) => ({
      id: `plan-${section}`,
      title: `Plan — ${section}`,
      intent: `The Plan tab’s “${section}” section, as the venue publishes it.`,
      reach: async (page) => {
        await go(page, 'Plan');
        await setSheet(page, 'full');
        const tabs = page.locator('.planPanel .settingsTopic');
        if (await tabs.count()) {
          /* The section tabs only exist when the venue publishes heights; when
             they do, pick by position rather than by a label typed here. */
          const ids = planSections(index);
          await tabs.nth(ids.indexOf(section)).click();
          await page.waitForTimeout(400);
        } else if (section !== 'stops') {
          throw new Error('this venue publishes no heights, so Plan has no section tabs');
        }
        await present(page, '.planPanel', 'the Plan panel');
      },
    })),
    {
      id: 'party',
      title: 'Party',
      intent: 'The Party tab before a party exists — the invitation to start one.',
      reach: async (page) => {
        await go(page, 'Party');
        await setSheet(page, 'full');
        await present(page, '.tabItem[data-tab="party"].on, .sheetBody', 'the Party tab');
      },
    },
    {
      id: 'party-live',
      title: 'Party — started',
      intent:
        'A party this capture really created, with the code the server really minted. ' +
        'Nothing here is a stand-in.',
      settle: 1600,
      reach: async (page) => {
        await go(page, 'Party');
        await setSheet(page, 'full');
        const start = page.getByRole('button', { name: 'Start a party' });
        if (await start.count()) {
          await start.click();
          await page.waitForTimeout(1800);
        }
        await present(page, '.codeText', 'the minted party code', 25000);
      },
    },
    {
      id: 'side-quests',
      title: 'Side Quests',
      intent: 'The Quests tab root.',
      reach: async (page) => {
        await go(page, 'Side Quests');
        await setSheet(page, 'full');
      },
    },
    {
      id: 'me',
      title: 'Me',
      intent: 'The Me tab root: the journey, the Title ladder and the way into everything else.',
      reach: async (page) => {
        await go(page, 'Me');
        await setSheet(page, 'full');
        await present(page, '.mePanel', 'the Me panel');
      },
    },
    {
      id: 'collection',
      title: 'Collection',
      intent: 'The Worlds this phone has been to, pushed under Me.',
      reach: async (page) => {
        await go(page, 'Collection');
        await setSheet(page, 'full');
        await present(page, '.worldCloset', 'the Collection screen');
      },
    },
    {
      id: 'marks',
      title: 'Marks',
      intent: 'What this phone has left and earned in a World, pushed under Collection.',
      reach: async (page) => {
        await go(page, 'Collection');
        await setSheet(page, 'full');
        const marks = page.locator('.worldCloset .row, .worldCloset button').filter({ hasText: /Marks/ });
        if (!(await marks.count())) throw new Error('Collection offered no way through to Marks');
        await marks.first().click();
        await page.waitForTimeout(500);
        await present(page, '.worldMarks', 'the Marks screen');
      },
    },
    ...settingsTopics(index).map(({ id, label }) => ({
      id: `settings-${id}`,
      title: `Settings — ${label}`,
      intent: `The “${label}” topic of Settings, pushed under Me.`,
      reach: async (page) => {
        await go(page, 'Settings');
        await setSheet(page, 'full');
        await present(page, '.settingsPanel', 'the Settings panel');
        const topic = page.locator('.settingsPanel .settingsTopic').filter({ hasText: label });
        if (!(await topic.count())) throw new Error(`Settings has no "${label}" topic on screen`);
        await topic.first().click();
        await page.waitForTimeout(400);
      },
    })),
  ];

  const ids = plan.map((s) => s.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new Error(`design-twin: two screens both call themselves "${dupe}"`);

  /* Every screen starts from neutral. Wrapped here rather than written into
     seventeen `reach` functions, because the one that forgets is the one that
     files the wrong shot under the right name. */
  return plan.map((screen) => ({
    ...screen,
    reach: async (page, ctx) => {
      await neutral(page);
      return screen.reach(page, ctx);
    },
  }));
}
