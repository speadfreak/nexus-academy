/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as achievements from "../achievements.js";
import type * as admin from "../admin.js";
import type * as adminCenter from "../adminCenter.js";
import type * as adminManagement from "../adminManagement.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as bookmarks from "../bookmarks.js";
import type * as calendar from "../calendar.js";
import type * as configKeys from "../configKeys.js";
import type * as constants from "../constants.js";
import type * as content from "../content.js";
import type * as contentAI from "../contentAI.js";
import type * as contentAdmin from "../contentAdmin.js";
import type * as crons from "../crons.js";
import type * as dailyChallenge from "../dailyChallenge.js";
import type * as flashcards from "../flashcards.js";
import type * as github from "../github.js";
import type * as groq from "../groq.js";
import type * as groupChat from "../groupChat.js";
import type * as http from "../http.js";
import type * as journey from "../journey.js";
import type * as media from "../media.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as payments from "../payments.js";
import type * as paymentsDb from "../paymentsDb.js";
import type * as profile from "../profile.js";
import type * as providers_mpesa from "../providers/mpesa.js";
import type * as providers_telebirr from "../providers/telebirr.js";
import type * as quizzes from "../quizzes.js";
import type * as quotes from "../quotes.js";
import type * as r2 from "../r2.js";
import type * as readerAI from "../readerAI.js";
import type * as recap from "../recap.js";
import type * as reminders from "../reminders.js";
import type * as rooms from "../rooms.js";
import type * as roomsActions from "../roomsActions.js";
import type * as safety from "../safety.js";
import type * as sampleContent from "../sampleContent.js";
import type * as scratchpads from "../scratchpads.js";
import type * as studyGroups from "../studyGroups.js";
import type * as studyPlans from "../studyPlans.js";
import type * as studySessions from "../studySessions.js";
import type * as subjects from "../subjects.js";
import type * as subscriptions from "../subscriptions.js";
import type * as systemEvents from "../systemEvents.js";
import type * as telegram from "../telegram.js";
import type * as telegramActions from "../telegramActions.js";
import type * as todos from "../todos.js";
import type * as tour from "../tour.js";
import type * as users from "../users.js";
import type * as xp from "../xp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  achievements: typeof achievements;
  admin: typeof admin;
  adminCenter: typeof adminCenter;
  adminManagement: typeof adminManagement;
  ai: typeof ai;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  bookmarks: typeof bookmarks;
  calendar: typeof calendar;
  configKeys: typeof configKeys;
  constants: typeof constants;
  content: typeof content;
  contentAI: typeof contentAI;
  contentAdmin: typeof contentAdmin;
  crons: typeof crons;
  dailyChallenge: typeof dailyChallenge;
  flashcards: typeof flashcards;
  github: typeof github;
  groq: typeof groq;
  groupChat: typeof groupChat;
  http: typeof http;
  journey: typeof journey;
  media: typeof media;
  notes: typeof notes;
  notifications: typeof notifications;
  payments: typeof payments;
  paymentsDb: typeof paymentsDb;
  profile: typeof profile;
  "providers/mpesa": typeof providers_mpesa;
  "providers/telebirr": typeof providers_telebirr;
  quizzes: typeof quizzes;
  quotes: typeof quotes;
  r2: typeof r2;
  readerAI: typeof readerAI;
  recap: typeof recap;
  reminders: typeof reminders;
  rooms: typeof rooms;
  roomsActions: typeof roomsActions;
  safety: typeof safety;
  sampleContent: typeof sampleContent;
  scratchpads: typeof scratchpads;
  studyGroups: typeof studyGroups;
  studyPlans: typeof studyPlans;
  studySessions: typeof studySessions;
  subjects: typeof subjects;
  subscriptions: typeof subscriptions;
  systemEvents: typeof systemEvents;
  telegram: typeof telegram;
  telegramActions: typeof telegramActions;
  todos: typeof todos;
  tour: typeof tour;
  users: typeof users;
  xp: typeof xp;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
