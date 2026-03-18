export function testFileSuffix(pattern: string): string {
  return pattern.startsWith("*") ? pattern.slice(1) : pattern
}

export function matchesTestFilePattern(filePath: string, pattern: string): boolean {
  return filePath.endsWith(testFileSuffix(pattern))
}
