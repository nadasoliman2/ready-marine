const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeText, tokenize, boundedDistance,
    _test: { createCollection, addEntry, sealCollection, searchCollection },
} = require('../services/searchSuggestService');

const collectionOf = (titles) => {
    const collection = createCollection();
    titles.forEach((title) => addEntry(collection, { title }, [[title, 1]]));
    return sealCollection(collection);
};

const titlesFound = (collection, query) => searchCollection(collection, tokenize(query)).results
    .sort((a, b) => b.score - a.score)
    .map((r) => collection.entries[r.at].title);

test('Arabic letter variants, diacritics and digits fold together', () => {
    assert.equal(normalizeText('أَحْمَد إبراهيم آمال'), 'احمد ابراهيم امال');
    assert.equal(normalizeText('شنطة مستشفى'), 'شنطه مستشفي');
    assert.equal(normalizeText('موديل ٢٠١٩'), 'موديل 2019');
    assert.equal(normalizeText('Citroën C-Elysée'), 'citroen c elysee');
});

test('a leading "ال" does not matter', () => {
    assert.deepEqual(tokenize('الفرامل الامامية'), ['فرامل', 'اماميه']);
});

test('edit distance counts a swap of neighbours as one typo', () => {
    assert.equal(boundedDistance('braek', 'brake', 2), 1);
    assert.equal(boundedDistance('filtr', 'filter', 2), 1);
    assert.equal(boundedDistance('abc', 'xyz', 1), 2);
});

test('every word must match, in any order, the last one as a prefix', () => {
    const c = collectionOf(['Front brake pads Toyota', 'Rear brake disc', 'Oil filter Toyota']);
    assert.deepEqual(titlesFound(c, 'toyota brake'), ['Front brake pads Toyota']);
    assert.deepEqual(titlesFound(c, 'brake pa'), ['Front brake pads Toyota']);
    assert.equal(titlesFound(c, 'brake').length, 2);
});

test('Arabic is matched the way it is typed', () => {
    const c = collectionOf(['تيل الفرامل الأمامية', 'شنطة السيارة', 'فلتر هواء']);
    assert.deepEqual(titlesFound(c, 'فرامل امامي'), ['تيل الفرامل الأمامية']);
    assert.deepEqual(titlesFound(c, 'شنطه'), ['شنطة السيارة']);
    assert.deepEqual(titlesFound(c, 'فلتر هوا'), ['فلتر هواء']);
});

test('a mistyped word still finds its product and is reported as corrected', () => {
    const c = collectionOf(['Brake pads', 'Oil filter']);
    const { results, corrected } = searchCollection(c, tokenize('braek pads'));
    assert.equal(results.length, 1);
    assert.equal(c.entries[results[0].at].title, 'Brake pads');
    assert.equal(corrected, true);
});

test('nothing matches a word that is nowhere near', () => {
    const c = collectionOf(['Brake pads', 'Oil filter']);
    assert.deepEqual(titlesFound(c, 'zzzz'), []);
});
