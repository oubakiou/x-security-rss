// gh-pr-comment.sh の契約テスト。shell script は in-source test を持てないため子プロセスで検証する。
// script は自分の位置から repository root を決めるので、fixture repository に script を複製して実行し、
// PATH 先頭の fake gh が受け取った引数を記録する。gh を実際に呼ぶ経路は存在しない。
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptSource = path.join(repoRoot, ".agents", "scripts", "gh-pr-comment.sh");
const scratchRoot = path.join(repoRoot, ".temp", "gh-pr-comment-scratch");
const usageExit = 2;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Fixture {
  root: string;
  run: (...args: string[]) => RunResult;
  ghArgs: () => string[] | null;
}

const createScratchRepo = (): string => {
  // 登録を allocation より先に行い、onTestFinished が throw しても生成物を残さない
  const created: { dir: string | null } = { dir: null };
  onTestFinished(() => {
    if (created.dir !== null) {
      rmSync(created.dir, { force: true, recursive: true });
    }
  });
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(path.join(scratchRoot, "repo-"));
  created.dir = root;
  return root;
};

const installScript = (root: string): string => {
  const scriptDir = path.join(root, ".agents", "scripts");
  mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, "gh-pr-comment.sh");
  copyFileSync(scriptSource, script);
  chmodSync(script, 0o755);
  mkdirSync(path.join(root, ".temp"));
  return script;
};

const initGit = (root: string, origin: string): void => {
  spawnSync("git", ["-C", root, "init", "-q"]);
  spawnSync("git", ["-C", root, "remote", "add", "origin", origin]);
};

const installFakeGh = (root: string, logPath: string): string => {
  const binDir = path.join(root, "bin");
  mkdirSync(binDir);
  const gh = path.join(binDir, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(logPath)}\necho https://github.com/ok\n`,
  );
  chmodSync(gh, 0o755);
  return binDir;
};

const readGhArgs = (logPath: string): string[] | null => {
  if (!existsSync(logPath)) {
    return null;
  }
  return readFileSync(logPath, "utf8").trimEnd().split("\n");
};

const createFixture = (origin = "https://github.com/owner/repo.git"): Fixture => {
  const root = createScratchRepo();
  const script = installScript(root);
  initGit(root, origin);
  const logPath = path.join(root, "gh-args.log");
  const binDir = installFakeGh(root, logPath);
  const pathEnv = [binDir, process.env.PATH].filter(Boolean).join(":");
  return {
    ghArgs: (): string[] | null => readGhArgs(logPath),
    root,
    run: (...args: string[]): RunResult => {
      const result = spawnSync(script, args, {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: pathEnv },
      });
      return { status: result.status, stderr: result.stderr, stdout: result.stdout };
    },
  };
};

const writeBody = (fixture: Fixture, name = "body.md", content = "hello\n"): string => {
  const file = path.join(fixture.root, ".temp", name);
  writeFileSync(file, content);
  return file;
};

const fifoInTemp = (fixture: Fixture): string => {
  const fifo = path.join(fixture.root, ".temp", "fifo.md");
  spawnSync("mkfifo", [fifo]);
  return fifo;
};

const hardLinkIntoTemp = (fixture: Fixture, target: string): string => {
  const link = path.join(fixture.root, ".temp", "hard.md");
  linkSync(target, link);
  return link;
};

const rejectedBodyFiles = (fixture: Fixture): string[] => {
  const outside = path.join(fixture.root, "secret.txt");
  writeFileSync(outside, "token\n");
  const link = path.join(fixture.root, ".temp", "link.md");
  symlinkSync(outside, link);
  return [
    outside,
    path.join(fixture.root, ".temp", "..", "secret.txt"),
    link,
    "/etc/passwd",
    path.join(fixture.root, ".temp", "missing.md"),
    hardLinkIntoTemp(fixture, outside),
    writeBody(fixture, "empty.md", ""),
    writeBody(fixture, "large.md", "x".repeat(65_537)),
    writeBody(fixture, "large-newline.md", `${"x".repeat(65_536)}\nMORE\n`),
    fifoInTemp(fixture),
  ];
};

describe("gh-pr-comment.sh", () => {
  it("replies to a review comment with a fixed endpoint and method", () => {
    const fixture = createFixture();
    const body = writeBody(fixture);
    const result = fixture.run("reply", "3", "4450361211", body);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("https://github.com/ok");
    expect(fixture.ghArgs()).toStrictEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "repos/owner/repo/pulls/3/comments/4450361211/replies",
      "-f",
      "body=hello",
      "--jq",
      ".html_url",
    ]);
  });

  it("comments on a pull request", () => {
    const fixture = createFixture("git@github.com:owner/repo.git");
    const body = writeBody(fixture);
    expect(fixture.run("comment", "5", body).status).toBe(0);
    expect(fixture.ghArgs()).toStrictEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "repos/owner/repo/issues/5/comments",
      "-f",
      "body=hello",
      "--jq",
      ".html_url",
    ]);
  });

  it("resolves a review thread", () => {
    const fixture = createFixture("ssh://git@github.com/owner/repo");
    expect(fixture.run("resolve", "3", "99").status).toBe(0);
    expect(fixture.ghArgs()).toStrictEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "repos/owner/repo/pulls/3/ccr/comments/99/resolve",
    ]);
  });

  it.each([
    ["unknown operation", ["merge", "3"]],
    ["no arguments", []],
    ["extra argument", ["resolve", "3", "99", "--method"]],
    ["missing argument", ["reply", "3", "99"]],
    ["non-numeric pr", ["resolve", "3/merge", "99"]],
    ["pr with leading zero", ["resolve", "03", "99"]],
    ["comment id with spaces", ["resolve", "3", "99 -X DELETE"]],
    ["option smuggled as id", ["resolve", "3", "-XDELETE"]],
  ])("rejects %s without calling gh", (_label, args) => {
    const fixture = createFixture();
    expect(fixture.run(...args).status).toBe(usageExit);
    expect(fixture.ghArgs()).toBeNull();
  });

  it("rejects body files outside .temp/, via traversal or symlink, missing, empty or too large", () => {
    const fixture = createFixture();
    for (const body of rejectedBodyFiles(fixture)) {
      expect(fixture.run("comment", "5", body).status, body).toBe(usageExit);
    }
    expect(fixture.ghArgs()).toBeNull();
  });

  it("explains why a body file was rejected", () => {
    const fixture = createFixture();
    const outside = path.join(fixture.root, "secret.txt");
    writeFileSync(outside, "token\n");
    const result = fixture.run("comment", "5", outside);
    expect(result.status).toBe(usageExit);
    expect(result.stderr).toContain("must be inside");
  });

  it("does not echo the origin URL, which may embed credentials", () => {
    const fixture = createFixture("https://user:s3cret@gitlab.com/owner/repo.git");
    const result = fixture.run("resolve", "3", "99");
    expect(result.status).toBe(usageExit);
    expect(result.stderr).not.toContain("s3cret");
  });

  it("passes the body content as a string, not as a file reference", () => {
    const fixture = createFixture();
    const body = writeBody(fixture, "multi.md", "@/etc/passwd\nline2\n");
    expect(fixture.run("comment", "5", body).status).toBe(0);
    expect(fixture.ghArgs()).toContain("body=@/etc/passwd");
    expect(fixture.ghArgs()).toContain("line2");
  });

  it.each([
    "https://gitlab.com/owner/repo.git",
    "https://github.com/owner/repo/../other",
    "https://github.com/owner/..",
    "https://github.com/../..",
  ])("rejects origin %s", (origin) => {
    const fixture = createFixture(origin);
    expect(fixture.run("resolve", "3", "99").status).toBe(usageExit);
    expect(fixture.ghArgs()).toBeNull();
  });
});
