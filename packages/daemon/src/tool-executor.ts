import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, relative, join, dirname } from "node:path"
import { type LlmToolDefinition } from "./llm-api.js"

export type ToolResult = {
  output: string
  is_error: boolean
}

function safePath(rootDir: string, filePath: string): string {
  const full = resolve(rootDir, filePath)
  if (!full.startsWith(resolve(rootDir))) {
    throw new Error(`path traversal detected: ${filePath}`)
  }
  return full
}

export function getToolDefinitions(): LlmToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "File path relative to project root" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "Replace a string in a file with another string",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to project root" },
            old_string: { type: "string", description: "The exact string to find and replace" },
            new_string: { type: "string", description: "The replacement string" },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write content to a file, creating parent directories if needed",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to project root" },
            content: { type: "string", description: "File content to write" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "bash",
        description: "Execute a bash command",
        parameters: {
          type: "object",
          properties: { command: { type: "string", description: "The bash command to execute" } },
          required: ["command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "glob_files",
        description: "Search for files matching a pattern",
        parameters: {
          type: "object",
          properties: { pattern: { type: "string", description: "Search pattern (supports * wildcard)" } },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "grep_files",
        description: "Search file contents for a pattern using grep",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Search pattern (regex)" },
            path: { type: "string", description: "Directory to search in (default: project root)" },
          },
          required: ["pattern"],
        },
      },
    },
  ]
}

// Simple wildcard matching: converts "*.ts" to regex, supports * and **
function wildcardMatch(pattern: string, str: string): boolean {
  // Convert glob-like pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${escaped}$`).test(str)
}

function walkDir(dir: string, rootDir: string, results: string[]): void {
  let names: string[]
  try {
    names = readdirSync(dir) as string[]
  } catch {
    return
  }
  for (const name of names) {
    if (name === "node_modules" || name === ".git") continue
    const fullPath = join(dir, name)
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walkDir(fullPath, rootDir, results)
      } else {
        results.push(relative(rootDir, fullPath))
      }
    } catch {
      // skip inaccessible entries
    }
  }
}

export function executeTool(name: string, args: Record<string, unknown>, rootDir: string): ToolResult {
  try {
    switch (name) {
      case "read_file": {
        const filePath = safePath(rootDir, args.path as string)
        const content = readFileSync(filePath, "utf-8")
        return { output: content, is_error: false }
      }
      case "edit_file": {
        const filePath = safePath(rootDir, args.path as string)
        const content = readFileSync(filePath, "utf-8")
        const oldStr = args.old_string as string
        const newStr = args.new_string as string
        if (!content.includes(oldStr)) {
          return { output: `old_string not found in ${args.path}`, is_error: true }
        }
        writeFileSync(filePath, content.replace(oldStr, newStr), "utf-8")
        return { output: `Edited ${args.path}`, is_error: false }
      }
      case "write_file": {
        const filePath = safePath(rootDir, args.path as string)
        mkdirSync(dirname(filePath), { recursive: true })
        writeFileSync(filePath, args.content as string, "utf-8")
        return { output: `Wrote ${args.path}`, is_error: false }
      }
      case "bash": {
        const command = args.command as string
        try {
          const stdout = execFileSync("bash", ["-c", command], {
            cwd: rootDir,
            timeout: 30000,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          })
          return { output: stdout, is_error: false }
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string }
          const output = [e.stdout, e.stderr].filter(Boolean).join("\n") || e.message || "command failed"
          return { output, is_error: true }
        }
      }
      case "glob_files": {
        const pattern = args.pattern as string
        const files: string[] = []
        walkDir(rootDir, rootDir, files)
        const matched = files.filter((f) => wildcardMatch(pattern, f))
        return { output: matched.length > 0 ? matched.join("\n") : "No files matched", is_error: false }
      }
      case "grep_files": {
        const pattern = args.pattern as string
        const searchPath = args.path ? safePath(rootDir, args.path as string) : rootDir
        try {
          const stdout = execFileSync(
            "grep",
            ["-rn", "--include=*.ts", "--include=*.js", "--include=*.json", pattern, searchPath],
            { cwd: rootDir, timeout: 15000, encoding: "utf-8", maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
          )
          return { output: stdout, is_error: false }
        } catch (err: unknown) {
          const e = err as { status?: number; stdout?: string }
          // grep returns exit code 1 for no matches
          if (e.status === 1) {
            return { output: "No matches found", is_error: false }
          }
          return { output: e.stdout || "grep failed", is_error: true }
        }
      }
      default:
        return { output: `Unknown tool: ${name}`, is_error: true }
    }
  } catch (err: unknown) {
    return { output: (err as Error).message, is_error: true }
  }
}
