/*
 * @license
 * Copyright (c) 2017 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

const assert = require('assert');

function pierceShadows(selectors) {
  return browser.execute(function(selectors) {
    return pierceShadows(selectors);
  }, selectors);
}
function pierceShadowsSingle(selectors) {
  return browser.execute(function(selectors) {
    return pierceShadowsSingle(selectors);
  }, selectors);
}

/** Wait a short, approximate time (up to 10 seconds). */
function wait(seconds) {
  let count = 0;
  browser.waitUntil(
    () => {
      count += 1;
      return count >= seconds;
    },
    10000,
    `we should have exited after a few iterations`,
    1000
  );
}

/**
 * Search the list of elements, return the one that matches the textQuery.
 * (return an error if there are multiple matches, null if there are none).
 * The return format should be an object with the format:
 *   {id: <element-id>, text: <found text>}
 */
function searchElementsForText(elements, textQuery) {
  const textToId = elements.map(value => {
    return {
      id: value.ELEMENT,
      text: browser.elementIdText(value.ELEMENT).value
    };
  });
  assert.ok(textToId.length > 0, textToId);
  assert.equal(textToId.length, elements.length);

  const matches = textToId.reduce((accumulator, currentValue) => {
    const found = currentValue.text.includes(textQuery) ? currentValue : null;
    if (accumulator && found) {
      throw Error(`found two matches ${accumulator}, ${found}`);
    } else if (accumulator) {
      return accumulator;
    }

    return found;
  }, null);

  return matches;
}

/** Load the selenium utils into the current page. */
function loadSeleniumUtils() {
  var result = browser.execute(function(baseUrl) {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = `${baseUrl}/test/selenium-utils.js`;
    document.getElementsByTagName('head')[0].appendChild(script);
  }, browser.options.baseUrl);
  browser.waitUntil(() => {
    try {
      // To see if our selenium-utils has finished loading, try one of the
      // methods (pierceShadows()) with an arbitrary argument. If the utils
      // haven't loaded yet this will throw an exception.
      browser.execute('pierceShadows(["head"])');
    } catch (e) {
      if (e.message.includes('pierceShadows is not defined')) {
        console.log(
          `spin-waiting for pierceShadows to load; the error indicates it's not yet loaded so we'll try again (up to a point). Error: ${e}`
        );
        return false;
      }
      throw e;
    }
    return true;
  });
}

/** Wait until the element specified by selectors is visible. Unlike the
 * normal #waitForVisible()
 * (http://webdriver.io/api/utility/waitForVisible.html) this will traverse
 * the shadow DOM. */
function waitForVisible(selectors) {
  browser.waitUntil(
    () => {
      const selected = pierceShadows(selectors);
      const isVisible = selected.value && selected.value.length > 0;
      return isVisible;
    },
    5000,
    `selectors ${selectors} never selected anything`,
    500
  );
}

function dancingDotsElement() {
  return pierceShadowsSingle([
    'x-toast[app-footer]',
    'dancing-dots'
  ]);
}

/** wait for the dancing dots to stop. */
function waitForStillness() {
  var element = dancingDotsElement();

  browser.waitUntil(
    () => {
      var result = browser.elementIdAttribute(element.value.ELEMENT, 'animate');
      return null == result.value;
    },
    5000,
    `the dancing dots can't stop won't stop`,
    1000
  );
}

function _waitForSuggestionsDrawerToBeOpen(footerPath) {
  try {
    browser.waitUntil(
      () => {
        const footer = pierceShadowsSingle(footerPath);
        const open = browser.elementIdAttribute(footer.value.ELEMENT, 'open');
        return open.value;
      },
      500,
      `the suggestions drawer was never open`,
      100
    );
    return true;
  } catch (e) {
    return false;
  }
}

function openSuggestionDrawer(footerPath) {
  // pause before we start; sometimes the drawer is in animation
  wait(2);
  const suggestionsOpen = _waitForSuggestionsDrawerToBeOpen(footerPath);
  if (!suggestionsOpen) {
    const dancingDots = dancingDotsElement();
    browser.elementIdClick(dancingDots.value.ELEMENT);

    // after the click, wait a beat for the animation to finish
    wait(2);

    if (!_waitForSuggestionsDrawerToBeOpen(footerPath)) {
      throw Error(`suggestions drawer never opened even after a click`);
    }
  }
}

function allSuggestions(footerPath) {
  waitForStillness();

  const magnifier = pierceShadowsSingle(
    footerPath.concat(['div[search]', 'i'])
  );
  browser.elementIdClick(magnifier.value.ELEMENT);
}

function acceptSuggestion(footerPath, textSubstring) {
  waitForStillness();
  openSuggestionDrawer(footerPath);

  const suggestionsRoot = pierceShadowsSingle(
    footerPath.concat(['suggestions-element'])
  );
  const suggestionsDiv = pierceShadowsSingle(
    footerPath.concat(['suggestions-element', 'div'])
  );
  browser.waitUntil(
    () => {
      const allSuggestions = browser.elementIdElements(
        suggestionsDiv.value.ELEMENT,
        'suggest'
      );
      if (!allSuggestions.value || 0 == allSuggestions.value) {
        return false;
      }

      try {
        const desiredSuggestion = searchElementsForText(
          allSuggestions.value,
          textSubstring
        );
        if (!desiredSuggestion) {
          return false;
        }

        browser.elementIdClick(desiredSuggestion.id);
        return true;
      } catch (e) {
        if (e.message.includes('stale element reference')) {
          console.log(
            `spin-wait on accepting a suggestion - got an error indicating we're not ready, so waitUntil will try again (up to a point). Error: ${e}`
          );
          return false;
        }

        throw e;
      }
    },
    5000,
    `couldn't find suggestion ${textSubstring}`
  );
}

function particleSelectors(slotName, selectors) {
  return ['arc-host', `div[slotid="${slotName}"]`].concat(selectors);
}

/**
 * Click in the main arcs app, in the slot with the name 'slotName', using the
 * specified selectors, filtering by the optional textQuery.
 */
function clickInParticles(slotName, selectors, textQuery) {
  waitForStillness();

  if (!selectors) selectors = [];
  const realSelectors = ['div[arc-panel]', `div[slotid="${slotName}"]`].concat(
    selectors
  );

  browser.waitUntil(
    () => {
      const pierced = pierceShadows(realSelectors);
      assert.ok(pierced);
      if (!pierced.value || pierced.value.length == 0) {
        return false;
      }

      let selected;
      if (textQuery) {
        selected = searchElementsForText(pierced.value, textQuery).id;
      } else {
        if (1 == pierced.value.length) {
          selected = pierced.value[0].ELEMENT;
        } else {
          throw Error(
            `found multiple matches for ${realSelectors}: ${pierced.value}`
          );
        }
      }

      if (selected) {
        browser.elementIdClick(selected);
        return true;
      } else {
        return false;
      }
    },
    5000,
    `couldn't find anything to click with selectors ${realSelectors} textQuery ${textQuery}`
  );
}

describe('test basic arcs functionality', function() {
  it('can use the restaurant demo flow', function() {
    // TODO(smalls) should we create a user on the fly?
    // note - baseUrl (currently specified on the command line) must end in a
    // trailing '/', and this must not begin with a preceding '/'.
    browser.url(
      `apps/web/?solo=${browser.options.baseUrl}artifacts/canonical.manifest`
    );

    assert.equal('Arcs', browser.getTitle());

    // wait for the page to load a bit, init the test harness for this page
    browser.waitForVisible('<app-shell>');
    loadSeleniumUtils();

    // check out some basic structure relative to the app footer
    const footerPath = ['x-toast[app-footer]'];
    assert.ok(pierceShadowsSingle(footerPath.slice(0, 1)).value);
    assert.ok(pierceShadowsSingle(footerPath).value);

    allSuggestions(footerPath);

    wait(2);
    acceptSuggestion(footerPath, 'Find restaurants');

    // Our location is relative to where you are now, so this list is dynamic.
    // Rather than trying to mock this out let's just grab the first
    // restaurant.
    clickInParticles('root', ['div.item', 'div.title', 'span'], 'Tacolicious');

    acceptSuggestion(footerPath, 'Make a reservation');
    acceptSuggestion(footerPath, 'You are free');

    // to drop into debug mode with a REPL; also a handy way to see the state
    // at the end of the test:
    // browser.debug();
  });
});
