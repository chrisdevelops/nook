export const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const ALPHABET_LENGTH = 32;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const MAX_TIME = 2 ** 48 - 1;

export type GenerateUlidOptions = {
  readonly now: () => number;
  readonly random: () => number;
};

export const generateUlid = ({ now, random }: GenerateUlidOptions): string => {
  const timestamp = now();
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RangeError(`ULID time must be a finite, non-negative number; got ${timestamp}`);
  }
  if (timestamp > MAX_TIME) {
    throw new RangeError(`ULID time exceeds 48-bit maximum (${MAX_TIME}); got ${timestamp}`);
  }
  return encodeTime(Math.floor(timestamp)) + encodeRandom(random);
};

const encodeTime = (time: number): string => {
  let remaining = time;
  let out = "";
  for (let position = TIME_LENGTH - 1; position >= 0; position--) {
    const mod = remaining % ALPHABET_LENGTH;
    out = ULID_ALPHABET[mod] + out;
    remaining = (remaining - mod) / ALPHABET_LENGTH;
  }
  return out;
};

const encodeRandom = (random: () => number): string => {
  let out = "";
  for (let index = 0; index < RANDOM_LENGTH; index++) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError(`random() must return a value in [0, 1); got ${value}`);
    }
    out += ULID_ALPHABET[Math.floor(value * ALPHABET_LENGTH)];
  }
  return out;
};
