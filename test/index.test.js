"use strict";
// You can import your modules
// import index from '../src/index'
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var nock_1 = require("nock");
// Requiring our app implementation
var index_js_1 = require("../src/index.js");
var probot_1 = require("probot");
// Requiring our fixtures
//import payload from "./fixtures/issues.opened.json" with { "type": "json"};
var fs_1 = require("fs");
var path_1 = require("path");
var url_1 = require("url");
var vitest_1 = require("vitest");
var issueCreatedBody = { body: "Thanks for opening this issue!" };
var __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
var privateKey = fs_1.default.readFileSync(path_1.default.join(__dirname, "fixtures/mock-cert.pem"), "utf-8");
var payload = JSON.parse(fs_1.default.readFileSync(path_1.default.join(__dirname, "fixtures/issues.opened.json"), "utf-8"));
(0, vitest_1.describe)("My Probot app", function () {
    var probot;
    (0, vitest_1.beforeEach)(function () {
        nock_1.default.disableNetConnect();
        probot = new probot_1.Probot({
            appId: 123,
            privateKey: privateKey,
            // disable request throttling and retries for testing
            Octokit: probot_1.ProbotOctokit.defaults({
                retry: { enabled: false },
                throttle: { enabled: false },
            }),
        });
        // Load our app into probot
        probot.load(index_js_1.default);
    });
    (0, vitest_1.test)("creates a comment when an issue is opened", function () { return __awaiter(void 0, void 0, void 0, function () {
        var mock;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    mock = (0, nock_1.default)("https://api.github.com")
                        // Test that we correctly return a test token
                        .post("/app/installations/2/access_tokens")
                        .reply(200, {
                        token: "test",
                        permissions: {
                            issues: "write",
                        },
                    })
                        // Test that a comment is posted
                        .post("/repos/hiimbex/testing-things/issues/1/comments", function (body) {
                        (0, vitest_1.expect)(body).toMatchObject(issueCreatedBody);
                        return true;
                    })
                        .reply(200);
                    // Receive a webhook event
                    return [4 /*yield*/, probot.receive({ name: "issues", payload: payload })];
                case 1:
                    // Receive a webhook event
                    _a.sent();
                    (0, vitest_1.expect)(mock.pendingMocks()).toStrictEqual([]);
                    return [2 /*return*/];
            }
        });
    }); });
    (0, vitest_1.afterEach)(function () {
        nock_1.default.cleanAll();
        nock_1.default.enableNetConnect();
    });
});
// For more information about testing with Jest see:
// https://facebook.github.io/jest/
// For more information about using TypeScript in your tests, Jest recommends:
// https://github.com/kulshekhar/ts-jest
// For more information about testing with Nock see:
// https://github.com/nock/nock
