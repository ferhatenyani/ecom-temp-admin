import "@testing-library/jest-dom/vitest";

// The seal is exercised by the unit suite, so it needs a key. Any 32+ characters
// will do — the test asserts the round trip, not the secret.
process.env.SESSION_SECRET = "test-secret-that-is-long-enough-to-pass";
