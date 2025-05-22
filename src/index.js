"use strict";
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
var azdev = require("azure-devops-node-api");
// constant of Status column names
var STATUS_COLUMN_NAMES = [
    "Assigned by Sam",
    "Repeat Tasks",
    "Not Yet Started",
    "In Progress",
    "Done"
];
var orgUrl = "https://dev.azure.com/ursa-minus";
var token = process.env.ADO_TOKEN || '';
var authHandler = azdev.getPersonalAccessTokenHandler(token);
var connection = new azdev.WebApi(orgUrl, authHandler);
exports.default = (function (app) {
    app.on("issues.opened", function (context) { return __awaiter(void 0, void 0, void 0, function () {
        var issueTitle, firstComment;
        return __generator(this, function (_a) {
            issueTitle = context.payload.issue.title || "";
            firstComment = context.payload.issue.body || "";
            sendToADO(issueTitle, firstComment);
            return [2 /*return*/];
        });
    }); });
    app.on("projects_v2_item.edited", function (context) { return __awaiter(void 0, void 0, void 0, function () {
        var payload, changes, fromValue, toValue, fieldName, fieldType;
        return __generator(this, function (_a) {
            payload = context.payload;
            // Extract from and to fields if they exist
            if (payload.changes && payload.changes.field_value) {
                changes = payload.changes.field_value;
                fromValue = changes.from || null;
                toValue = changes.to || null;
                fieldName = changes.field_name || '';
                fieldType = changes.field_type || '';
                // Check that that fromValue and toValue are not null and both exist in the STATUS_COLUMN_NAMES array
                if (fromValue && toValue && STATUS_COLUMN_NAMES.includes(fromValue.name) && STATUS_COLUMN_NAMES.includes(toValue.name)) {
                    console.log("Field \"".concat(fieldName, "\" (").concat(fieldType, ") changed from \"").concat(fromValue.name, "\" to \"").concat(toValue.name, "\""));
                    syncStatusChange(fromValue.name, toValue.name, payload.projects_v2_item);
                }
                else {
                    console.log("Field change is not related to status columns or values are null");
                }
            }
            return [2 /*return*/];
        });
    }); });
});
function sendToADO(issueTitle, firstComment) {
    return __awaiter(this, void 0, void 0, function () {
        var workItemTrackingApi, project, workItemType, patchDocument, createdWorkItem, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, connection.getWorkItemTrackingApi()];
                case 1:
                    workItemTrackingApi = _a.sent();
                    project = "ursa";
                    workItemType = "Issue";
                    patchDocument = [
                        {
                            op: "add",
                            path: "/fields/System.Title",
                            value: issueTitle
                        },
                        {
                            op: "add",
                            path: "/fields/System.Description",
                            value: firstComment
                        },
                        // Add other fields as needed
                        {
                            op: "add",
                            path: "/fields/System.Tags",
                            value: "GitHub Import"
                        }
                    ];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, workItemTrackingApi.createWorkItem(null, // No template
                        patchDocument, project, workItemType)];
                case 3:
                    createdWorkItem = _a.sent();
                    console.log("Work item created: ID ".concat(createdWorkItem.id));
                    return [2 /*return*/, createdWorkItem];
                case 4:
                    error_1 = _a.sent();
                    console.error("Error creating work item:", error_1);
                    throw error_1;
                case 5: return [2 /*return*/];
            }
        });
    });
}
function syncStatusChange(fromValue, toValue, item) {
    return __awaiter(this, void 0, void 0, function () {
        var workApi, teamContext, boards, boardColumns, matchingColumn, workItemTitle, workItemDescription, workItemTrackingApi, project, workItemType, stateMapping, patchDocument, columnName, createdWorkItem, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Implement your logic to sync the status change
                    console.log("\uD83E\uDDEA Syncing status change from \"".concat(fromValue, "\" to \"").concat(toValue, "\" for item ").concat(item, " \uD83E\uDDEA"));
                    console.log("GitHub item data:", item);
                    return [4 /*yield*/, connection.getWorkApi()];
                case 1:
                    workApi = _a.sent();
                    teamContext = {
                        project: "ursa",
                        team: "ursa Team"
                    };
                    return [4 /*yield*/, workApi.getBoards(teamContext)];
                case 2:
                    boards = _a.sent();
                    console.log("Boards: 🧪", boards);
                    return [4 /*yield*/, workApi.getBoardColumns(teamContext, "Issues")];
                case 3:
                    boardColumns = _a.sent();
                    console.log("Board columns: ⚗️", boardColumns);
                    matchingColumn = boardColumns.find(function (col) { return col.name === toValue; });
                    if (!matchingColumn) return [3 /*break*/, 9];
                    console.log("Found matching column in ADO: ".concat(matchingColumn.name, " (ID: ").concat(matchingColumn.id, ")"));
                    workItemTitle = item.title || "GitHub Issue";
                    workItemDescription = item.content || "No description provided";
                    return [4 /*yield*/, connection.getWorkItemTrackingApi()];
                case 4:
                    workItemTrackingApi = _a.sent();
                    project = "ursa";
                    workItemType = "Issue";
                    stateMapping = {
                        "Not Yet Started": "New",
                        "In Progress": "Active",
                        "Done": "Closed"
                    };
                    patchDocument = [
                        {
                            op: "add",
                            path: "/fields/System.Title",
                            value: workItemTitle
                        },
                        {
                            op: "add",
                            path: "/fields/System.Description",
                            value: workItemDescription
                        },
                        {
                            op: "add",
                            path: "/fields/System.Tags",
                            value: "GitHub Import"
                        }
                    ];
                    columnName = matchingColumn.name;
                    if (columnName in stateMapping) {
                        patchDocument.push({
                            op: "add",
                            path: "/fields/System.State",
                            value: stateMapping[columnName]
                        });
                    }
                    _a.label = 5;
                case 5:
                    _a.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, workItemTrackingApi.createWorkItem(null, // No template
                        patchDocument, project, workItemType)];
                case 6:
                    createdWorkItem = _a.sent();
                    console.log("Work item created with state mapping to column ".concat(matchingColumn.name, ": ID ").concat(createdWorkItem.id));
                    return [2 /*return*/, createdWorkItem];
                case 7:
                    error_2 = _a.sent();
                    console.error("Error creating work item:", error_2);
                    throw error_2;
                case 8: return [3 /*break*/, 10];
                case 9:
                    console.log("No matching column found for \"".concat(toValue, "\" in ADO board"));
                    return [2 /*return*/, null];
                case 10: return [2 /*return*/];
            }
        });
    });
}
