import { expect, test } from "bun:test"
import { assertSafeTestDatabaseName } from "./reset-test-database"

test("allows only database names ending in _test", () => {
  expect(() => assertSafeTestDatabaseName("islam_pedia_test")).not.toThrow()
  expect(() => assertSafeTestDatabaseName("islam_pedia")).toThrow(
    'Refusing to clean database "islam_pedia"',
  )
  expect(() => assertSafeTestDatabaseName("islam_pedia_testing")).toThrow()
})
