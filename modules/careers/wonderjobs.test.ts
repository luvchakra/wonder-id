// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The saved key (vendor console) wins; with none saved, the environment variable applies.
let saved: { key: string | null; baseUrl: string | null } | null = null;
vi.mock("@/modules/platform-admin/service", () => ({
  resolveCareersCredentials: async () => saved ?? { key: process.env.WONDERJOBS_CAREERS_KEY || null, baseUrl: process.env.WONDERJOBS_CAREERS_URL || null },
}));

import { careerApplicationStatus, careersBase, checkCareersKey, getCareerJob, listCareerJobs, submitCareerApplication } from "./wonderjobs";
import { descriptionBlocks, jobFacts } from "./format";

const job = { id: "ejob_1", title: "Senior Full-Stack Engineer", location: "Remote, India", workMode: "remote", jobType: "full_time", currency: "INR", description: "x", skills: [], company: "WonderID", updatedAt: "2026-10-21T00:00:00Z" };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WONDERJOBS_CAREERS_KEY", "wjcs_testkey_0123456789abcdef");
  vi.stubEnv("WONDERJOBS_CAREERS_URL", "");
});
afterEach(() => {
  saved = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("the WonderJobs careers client", () => {
  it("only talks to an https wonderapps.biz host", () => {
    expect(careersBase({})).toBe("https://jobs.wonderapps.biz");
    expect(careersBase({ WONDERJOBS_CAREERS_URL: "https://jobs.wonderapps.biz/" })).toBe("https://jobs.wonderapps.biz");
    expect(careersBase({ WONDERJOBS_CAREERS_URL: "https://evil.example.com" })).toBeNull();
    expect(careersBase({ WONDERJOBS_CAREERS_URL: "http://jobs.wonderapps.biz" })).toBeNull();
    expect(careersBase({ WONDERJOBS_CAREERS_URL: "https://wonderapps.biz.evil.com" })).toBeNull();
    expect(careersBase({ WONDERJOBS_CAREERS_URL: "http://localhost:3000", NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(careersBase({ WONDERJOBS_CAREERS_URL: "http://localhost:3000", NODE_ENV: "production" })).toBeNull();
  });

  it("says Needs setup without a key, and never calls out", async () => {
    vi.stubEnv("WONDERJOBS_CAREERS_KEY", "");
    expect(await listCareerJobs()).toEqual({ state: "needs_setup" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the site key only to WonderJobs, server side", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { jobs: [job] }));
    expect(await listCareerJobs()).toEqual({ state: "ok", data: [job] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jobs.wonderapps.biz/api/careers/v1/jobs");
    expect(init.headers.authorization).toBe("Bearer wjcs_testkey_0123456789abcdef");
  });

  it("uses the key saved in the console over the environment variable", async () => {
    saved = { key: "wjcs_consolekey_0123456789abcdef", baseUrl: null };
    fetchMock.mockReturnValueOnce(reply(200, { jobs: [] }));
    await listCareerJobs();
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer wjcs_consolekey_0123456789abcdef");
  });

  it("checks a key with WonderJobs before it is saved", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { site: { name: "WonderID careers" }, jobs: [job, job] }));
    expect(await checkCareersKey("wjcs_new_0123456789abcdefgh", null)).toEqual({ state: "ok", site: "WonderID careers", jobs: 2 });
    fetchMock.mockReturnValueOnce(reply(401, { error: "Unknown career site key" }));
    expect(await checkCareersKey("wjcs_bad_0123456789abcdefgh", null)).toEqual({ state: "rejected" });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await checkCareersKey("wjcs_new_0123456789abcdefgh", null)).toEqual({ state: "unavailable" });
    expect(await checkCareersKey("wjcs_new_0123456789abcdefgh", "https://evil.example.com")).toEqual({ state: "bad_address" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a read once, never a write, and reports failure as Unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout")).mockReturnValueOnce(reply(200, { job }));
    expect((await getCareerJob("ejob_1")).state).toBe("ok");
    fetchMock.mockReset();
    fetchMock.mockReturnValue(reply(503, {}));
    expect(await submitCareerApplication("ejob_1", { name: "A", email: "a@b.co", resumeUrl: "https://x.co/cv", consent: true })).toEqual({ state: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes WonderJobs' own validation message through, and maps 404 to not found", async () => {
    fetchMock.mockReturnValueOnce(reply(409, { error: "You've already applied for this position." }));
    expect(await submitCareerApplication("ejob_1", { name: "A", email: "a@b.co", consent: true })).toEqual({ state: "rejected", message: "You've already applied for this position." });
    fetchMock.mockReturnValueOnce(reply(404, { error: "x" }));
    expect(await getCareerJob("ejob_1")).toEqual({ state: "not_found" });
  });

  it("rejects malformed ids and tokens before calling out, and keeps the token out of the URL", async () => {
    expect(await getCareerJob("../admin")).toEqual({ state: "not_found" });
    expect(await careerApplicationStatus("nope")).toEqual({ state: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockReturnValueOnce(reply(200, { application: { status: "new" } }));
    await careerApplicationStatus("wjst_" + "a".repeat(43));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jobs.wonderapps.biz/api/careers/v1/applications/status");
    expect(url).not.toContain("wjst_");
    expect(JSON.parse(init.body)).toEqual({ token: "wjst_" + "a".repeat(43), action: "view" });
  });
});

describe("formatting", () => {
  it("writes a job's facts in one line", () => {
    expect(jobFacts({ location: "Bengaluru", workMode: "hybrid", jobType: "full_time", currency: "INR" })).toBe("Bengaluru · Hybrid · Full-time");
  });

  it("turns a plain-text description into headings, paragraphs and lists", () => {
    expect(descriptionBlocks("Intro line\none.\n\nWhat you'll do:\n- Build\n- Ship")).toEqual([
      { kind: "p", text: "Intro line one." },
      { kind: "h", text: "What you'll do" },
      { kind: "ul", items: ["Build", "Ship"] },
    ]);
  });
});
