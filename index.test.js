const core = require("@actions/core");
const action = require("./index");

const nock = require("nock");
nock.disableNetConnect();

process.env.GITHUB_REPOSITORY = "demo/repo";

afterEach(() => {
  jest.restoreAllMocks();
  if (!nock.isDone()) {
    throw new Error(
      `Not all nock interceptors were used: ${JSON.stringify(
        nock.pendingMocks()
      )}`
    );
  }
  nock.cleanAll();
});

it("throws if no token is provided", async () => {
  expect(action).rejects.toThrow("Input required and not supplied: token");
});

it("throws if no workflow list is provided", async () => {
  mockInputToken();
  expect(action).rejects.toThrow("Input required and not supplied: workflows");
});

it("returns early if there are no runs with action required", async () => {
  mockInputToken();
  mockInputWorkflows();
  jest.spyOn(console, "log").mockImplementation(() => {});

  nock("https://api.github.com")
    .get("/repos/demo/repo/actions/runs?status=action_required")
    .reply(200, {
      total_count: 0,
      workflow_runs: [],
    });
  await action();
  expect(console.log).toBeCalledWith(
    "No runs found with status 'action_required'"
  );
});

it("returns early if there are no runs that match the provided workflow", async () => {
  mockInputToken();
  mockInputWorkflows();
  jest.spyOn(console, "log").mockImplementation(() => {});

  nock("https://api.github.com")
    .get("/repos/demo/repo/actions/runs?status=action_required")
    .reply(200, {
      total_count: 1,
      workflow_runs: [
        {
          name: ".github/workflows/other-workflow.yml",
          id: "12345678",
        },
      ],
    });

  await action();
  expect(console.log).toBeCalledWith(
    "No runs found for the following workflows: .github/workflows/pr.yml, .github/workflows/another.yml"
  );
});

it("removes any runs that edit .github/workflows", async () => {
  mockInputToken();
  mockInputWorkflows();
  jest.spyOn(console, "log").mockImplementation(() => {});

  nock("https://api.github.com")
    .get("/repos/demo/repo/actions/runs?status=action_required")
    .reply(200, {
      total_count: 2,
      workflow_runs: [
        {
          name: ".github/workflows/pr.yml",
          id: "12345678",
          head_branch: "patch-1",
          head_repository: {
            owner: {
              login: "user-a",
            },
          },
        },
        {
          name: ".github/workflows/pr.yml",
          id: "87654321",
          head_branch: "totally-honest-update-no-miners-here",
          head_repository: {
            owner: {
              login: "bad-actor",
            },
          },
        },
      ],
    });

  mockGetPr("user-a%3Apatch-1", 99);
  mockGetPr("bad-actor%3Atotally-honest-update-no-miners-here", 321);

  mockPrFiles(99, ["README.md"]);
  mockPrFiles(321, [".github/workflows/miner.yml"]);

  mockApprove(12345678);

  await action();
  expect(console.log).toBeCalledWith("Skipped dangerous run '87654321'");
  expect(console.log).toBeCalledWith("Approved run '12345678'");
});

it("removes any runs that edit a file in dangerous_files", async () => {
  mockInputToken();
  mockInputWorkflows();
  mockInputDangerousFiles("build.js");
  jest.spyOn(console, "log").mockImplementation(() => {});

  nock("https://api.github.com")
    .get("/repos/demo/repo/actions/runs?status=action_required")
    .reply(200, {
      total_count: 2,
      workflow_runs: [
        {
          name: ".github/workflows/pr.yml",
          id: "12345678",
          head_branch: "patch-1",
          head_repository: {
            owner: {
              login: "z-user",
            },
          },
        },
      ],
    });

  mockGetPr("z-user%3Apatch-1", 1713);

  mockPrFiles(1713, ["README.md", "build.js"]);

  await action();
  expect(console.log).toBeCalledWith("Skipped dangerous run '12345678'");
});

it("approves all pending workflows", async () => {
  mockInputToken();
  mockInputWorkflows();
  jest.spyOn(console, "log").mockImplementation(() => {});

  nock("https://api.github.com")
    .get("/repos/demo/repo/actions/runs?status=action_required")
    .reply(200, {
      total_count: 2,
      workflow_runs: [
        {
          name: ".github/workflows/pr.yml",
          id: "12345678",
          head_branch: "patch-1",
          head_repository: {
            owner: {
              login: "user-a",
            },
          },
        },
        {
          name: ".github/workflows/pr.yml",
          id: "87654321",
          head_branch: "update-readme",
          head_repository: {
            owner: {
              login: "user-b",
            },
          },
        },
      ],
    });

  mockGetPr("user-a%3Apatch-1", 99);
  mockGetPr("user-b%3Aupdate-readme", 42);

  mockPrFiles(99, ["README.md"]);
  mockPrFiles(42, ["README.md"]);

  mockApprove(12345678);
  mockApprove(87654321);

  await action();
  expect(console.log).toBeCalledWith("Approved run '12345678'");
  expect(console.log).toBeCalledWith("Approved run '87654321'");
});

function mockInputToken() {
  jest.spyOn(core, "getInput").mockImplementationOnce(() => "my-token");
}

function mockInputWorkflows(workflows) {
  workflows = workflows || "pr.yml,another.yml";
  jest
    .spyOn(core, "getInput")
    .mockImplementationOnce(() => "pr.yml,another.yml");
}

function mockInputDangerousFiles(files) {
  jest.spyOn(core, "getInput").mockImplementationOnce(() => files);
}

function mockGetPr(actor, number) {
  nock("https://api.github.com")
    .get(`/repos/demo/repo/pulls?head=${actor}`)
    .reply(200, [
      {
        number,
      },
    ]);
}

function mockPrFiles(number, files) {
  nock("https://api.github.com")
    .get(`/repos/demo/repo/pulls/${number}/files`)
    .reply(
      200,
      files.map((f) => {
        return { filename: f };
      })
    );
}

function mockApprove(run) {
  nock("https://api.github.com")
    .post(`/repos/demo/repo/actions/runs/${run}/approve`)
    .reply(200);
}
