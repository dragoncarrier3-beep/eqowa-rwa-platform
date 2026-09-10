import { expect } from 'chai';

import {
  AFRICAN_UNION_COUNTRIES,
  ALLOWED_COUNTRIES,
  COUNTRY_ALLOW_BATCH_SIZE,
  EU27_COUNTRIES,
  UNITED_KINGDOM,
  UNITED_STATES,
  chunkCountries,
} from '../../config/countries';
import { COUNTRY } from '../../config/eqowa';

describe('production country allow-list', () => {
  it('is 54 AU + EU27 + GB, with no duplicates', async () => {
    expect(AFRICAN_UNION_COUNTRIES).to.have.length(54);
    expect(EU27_COUNTRIES).to.have.length(27);
    expect(ALLOWED_COUNTRIES).to.have.length(82);
    expect(new Set(ALLOWED_COUNTRIES).size).to.equal(82);
  });

  it('includes the countries Larry confirmed and excludes the United States', async () => {
    expect(ALLOWED_COUNTRIES).to.include(COUNTRY.NIGERIA);
    expect(ALLOWED_COUNTRIES).to.include(COUNTRY.FRANCE);
    expect(ALLOWED_COUNTRIES).to.include(COUNTRY.GERMANY);
    expect(ALLOWED_COUNTRIES).to.include(UNITED_KINGDOM);
    expect(ALLOWED_COUNTRIES).to.not.include(UNITED_STATES);
    expect(ALLOWED_COUNTRIES).to.not.include(732);
  });

  it('splits into batches the factory can apply one call at a time', async () => {
    const chunks = chunkCountries(ALLOWED_COUNTRIES);

    expect(chunks.length).to.equal(Math.ceil(ALLOWED_COUNTRIES.length / COUNTRY_ALLOW_BATCH_SIZE));
    expect(chunks.every((chunk) => chunk.length <= COUNTRY_ALLOW_BATCH_SIZE)).to.be.true;
    expect(chunks.flat()).to.deep.equal([...ALLOWED_COUNTRIES]);
  });
});
