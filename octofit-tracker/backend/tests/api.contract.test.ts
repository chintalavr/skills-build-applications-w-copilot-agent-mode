import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { Activity, Team, User, Workout } from '../src/models/index.js';

let mongo: MongoMemoryServer;
const app = createApp();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([Activity.deleteMany({}), Team.deleteMany({}), User.deleteMany({}), Workout.deleteMany({})]);
});

async function createUserAndTeam(name: string, email: string, mascot: string, teamName = `${name} team`) {
  const team = await Team.create({ name: teamName, mascot, members: [] });
  const user = await User.create({ name, email, team: team._id, fitnessGoal: 'endurance' });
  await Team.updateOne({ _id: team._id }, { $addToSet: { members: user._id } });
  return { user, team };
}

describe('OctoFit API contract', () => {
  it('creates and lists valid activities while rejecting invalid input', async () => {
    const { user, team } = await createUserAndTeam('Mona', 'mona@example.com', 'Mona');
    const invalid = await request(app).post('/api/activities').send({});
    expect(invalid.status).toBe(400);
    const validInput = { userId: user._id.toString(), teamId: team._id.toString(), type: 'run', minutes: 30 };
    for (const invalidInput of [
      { ...validInput, type: '' },
      { ...validInput, type: '   ' },
      { ...validInput, type: 123 },
      { ...validInput, minutes: 0 },
      { ...validInput, minutes: -10 },
      { ...validInput, minutes: '30' },
      { ...validInput, minutes: null },
      { ...validInput, userId: 123 },
      { ...validInput, teamId: null },
    ]) {
      const response = await request(app).post('/api/activities').send(invalidInput);
      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(String));
    }
    const missingReferences = await request(app).post('/api/activities').send({ userId: new mongoose.Types.ObjectId().toString(), teamId: new mongoose.Types.ObjectId().toString(), type: 'run', minutes: 30 });
    expect(missingReferences.status).toBeGreaterThanOrEqual(400);
    expect(missingReferences.status).toBeLessThan(500);
    for (const missingReference of [
      { ...validInput, userId: new mongoose.Types.ObjectId().toString() },
      { ...validInput, teamId: new mongoose.Types.ObjectId().toString() },
    ]) {
      const response = await request(app).post('/api/activities').send(missingReference);
      expect(response.status).toBe(404);
    }
    for (const malformed of [{ userId: 'not-an-id', teamId: team._id.toString() }, { userId: user._id.toString(), teamId: 'not-an-id' }]) {
      const response = await request(app).post('/api/activities').send({ ...malformed, type: 'run', minutes: 30 });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(await Activity.countDocuments()).toBe(0);
    const created = await request(app).post('/api/activities').send({ ...validInput, points: 999, occurredAt: 'invalid date' });
    expect(created.status).toBe(201);
    const listed = await request(app).get('/api/activities');
    expect(listed.body.activities).toHaveLength(1);
    for (const activity of [created.body.activity, listed.body.activities[0]]) {
      expect(activity).toMatchObject({ user: user._id.toString(), team: team._id.toString(), type: 'run', minutes: 30 });
      expect(activity.points).toBe(30);
      expect(Number.isNaN(Date.parse(activity.occurredAt))).toBe(false);
    }
  });
  it('creates teams and exposes members', async () => {
    const member = await User.create({ name: 'Mona', email: 'mona@example.com', fitnessGoal: 'endurance' });
    const invalid = await request(app).post('/api/teams').send({ mascot: 'Mona' });
    expect(invalid.status).toBe(400);
    for (const input of [
      { name: '   ', mascot: 'Mona' },
      { name: 'Octocats' },
      { name: 'Octocats', mascot: '' },
      { name: 'Octocats', mascot: 123 },
      { name: 'Octocats', mascot: 'Mona', members: null },
      { name: 'Octocats', mascot: 'Mona', members: 'not-an-array' },
      { name: 'Octocats', mascot: 'Mona', members: ['not-an-id'] },
      { name: 'Octocats', mascot: 'Mona', members: [123] },
    ]) {
      const response = await request(app).post('/api/teams').send(input);
      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(String));
    }
    const missingMember = await request(app).post('/api/teams').send({
      name: 'Octocats', mascot: 'Mona', members: [member._id.toString(), new mongoose.Types.ObjectId().toString()],
    });
    expect(missingMember.status).toBe(404);
    expect(await Team.countDocuments()).toBe(0);
    const created = await request(app).post('/api/teams').send({ name: 'Octocats', mascot: 'Mona', members: [member._id.toString()] });
    expect(created.status).toBe(201);
    expect(created.body.team).toMatchObject({ name: 'Octocats', mascot: 'Mona' });
    const listed = await request(app).get('/api/teams');
    expect(listed.body.teams).toHaveLength(1);
    expect(listed.body.teams[0]).toMatchObject({ name: 'Octocats', mascot: 'Mona' });
    expect(listed.body.teams[0].members.map((id: string) => id.toString())).toContain(member._id.toString());
    const emptyTeam = await request(app).post('/api/teams').send({ name: 'Robocats', mascot: 'Hubot' });
    expect(emptyTeam.status).toBe(201);
    expect(emptyTeam.body.team).toMatchObject({ name: 'Robocats', mascot: 'Hubot', members: [] });
  });
  it('orders leaderboard entries by total points', async () => {
    const empty = await request(app).get('/api/leaderboard');
    expect(empty.status).toBe(200);
    expect(empty.body.leaderboard).toEqual([]);
    const mona = await createUserAndTeam('Mona', 'mona@example.com', 'Mona', 'Octocats');
    const hubot = await createUserAndTeam('Hubot', 'hubot@example.com', 'Hubot', 'Robocats');
    await Activity.create([
      { user: mona.user._id, team: mona.team._id, type: 'run', minutes: 50, points: 25, occurredAt: new Date() },
      { user: hubot.user._id, team: hubot.team._id, type: 'cycle', minutes: 20, points: 20, occurredAt: new Date() },
      { user: hubot.user._id, team: hubot.team._id, type: 'strength', minutes: 15, points: 15, occurredAt: new Date() },
    ]);
    const response = await request(app).get('/api/leaderboard');
    expect(response.status).toBe(200);
    expect(response.body.leaderboard.map(({ teamName, totalPoints, rank }: { teamName: string; totalPoints: number; rank: number }) => ({ teamName, totalPoints, rank }))).toEqual([
      { teamName: 'Robocats', totalPoints: 35, rank: 1 },
      { teamName: 'Octocats', totalPoints: 25, rank: 2 },
    ]);
    const tied = await createUserAndTeam('Copilot', 'copilot@example.com', 'Copilot', 'Codecats');
    await Team.create({ name: 'Newcats', mascot: 'Mona' });
    await Activity.create({
      user: tied.user._id, team: tied.team._id, type: 'run', minutes: 10, points: 25, occurredAt: new Date(),
    });
    const ranked = await request(app).get('/api/leaderboard');
    expect(ranked.status).toBe(200);
    expect(ranked.body.leaderboard).toEqual([
      { teamName: 'Robocats', totalPoints: 35, rank: 1 },
      { teamName: 'Codecats', totalPoints: 25, rank: 2 },
      { teamName: 'Octocats', totalPoints: 25, rank: 3 },
      { teamName: 'Newcats', totalPoints: 0, rank: 4 },
    ]);
  });
  it('suggests workouts that match each user activity pattern', async () => {
    const mona = await createUserAndTeam('Mona', 'mona@example.com', 'Mona', 'Octocats');
    const hubot = await createUserAndTeam('Hubot', 'hubot@example.com', 'Hubot', 'Robocats');
    await User.updateOne({ _id: hubot.user._id }, { $set: { fitnessGoal: 'strength' } });
    await Activity.create([
      { user: mona.user._id, team: mona.team._id, type: 'run', minutes: 40, points: 40, occurredAt: new Date() },
      { user: hubot.user._id, team: hubot.team._id, type: 'strength', minutes: 20, points: 20, occurredAt: new Date() },
    ]);
    await Workout.create([
      { title: 'Intervals', focus: 'endurance', minutes: 30, difficulty: 'moderate' },
      { title: 'Strength Circuit', focus: 'strength', minutes: 30, difficulty: 'moderate' },
    ]);

    const monaResponse = await request(app).get('/api/workouts/suggestions/mona%40example.com');
    expect(monaResponse.status).toBe(200);
    expect(monaResponse.body.suggestions[0]).toMatchObject({ title: 'Intervals', focus: 'endurance', reason: expect.stringMatching(/run|endurance|activity/i) });

    const hubotResponse = await request(app).get('/api/workouts/suggestions/hubot%40example.com');
    expect(hubotResponse.status).toBe(200);
    expect(hubotResponse.body.suggestions[0]).toMatchObject({ title: 'Strength Circuit', focus: 'strength', reason: expect.stringMatching(/strength|activity/i) });

    await Activity.updateOne({ user: mona.user._id }, { $set: { type: 'strength' } });
    const goalFirst = await request(app).get('/api/workouts/suggestions/mona%40example.com');
    expect(goalFirst.status).toBe(200);
    expect(goalFirst.body.suggestions[0]).toMatchObject({
      title: 'Intervals', focus: 'endurance', reason: expect.stringMatching(/endurance.*goal/i),
    });
    expect(goalFirst.body.suggestions[1]).toMatchObject({
      title: 'Strength Circuit', focus: 'strength', reason: expect.stringMatching(/strength.*activity/i),
    });

    const unknownResponse = await request(app).get('/api/workouts/suggestions/nobody%40example.com');
    expect(unknownResponse.status).toBe(404);
    expect(unknownResponse.body.error).toEqual(expect.any(String));
  });
  it('suggests workouts using the latest user activity when no goal workout matches', async () => {
    const mona = await createUserAndTeam('Mona', 'mona@example.com', 'Mona');
    const hubot = await createUserAndTeam('Hubot', 'hubot@example.com', 'Hubot');
    await User.updateOne({ _id: mona.user._id }, { $set: { fitnessGoal: 'mobility' } });
    await Activity.create([
      { user: mona.user._id, team: mona.team._id, type: 'strength', minutes: 20, points: 20, occurredAt: new Date('2026-10-01T12:00:00Z') },
      { user: mona.user._id, team: mona.team._id, type: 'cycle', minutes: 30, points: 30, occurredAt: new Date('2026-10-02T12:00:00Z') },
      { user: hubot.user._id, team: hubot.team._id, type: 'strength', minutes: 20, points: 20, occurredAt: new Date('2026-10-03T12:00:00Z') },
    ]);
    await Workout.create([
      { title: 'Strength Circuit', focus: 'strength', minutes: 30, difficulty: 'moderate' },
      { title: 'Intervals', focus: 'endurance', minutes: 30, difficulty: 'moderate' },
    ]);
    const response = await request(app).get('/api/workouts/suggestions/mona%40example.com');
    expect(response.status).toBe(200);
    expect(response.body.suggestions).toHaveLength(1);
    expect(response.body.suggestions[0]).toMatchObject({
      title: 'Intervals', focus: 'endurance', reason: expect.stringMatching(/cycle/i),
    });
  });
  it('suggests workouts from the goal without activities and returns empty when none match', async () => {
    await User.create({ name: 'Mona', email: 'mona@example.com', fitnessGoal: 'endurance' });
    await Workout.create({ title: 'Intervals', focus: 'endurance', minutes: 30, difficulty: 'moderate' });
    const response = await request(app).get('/api/workouts/suggestions/mona%40example.com');
    expect(response.status).toBe(200);
    expect(response.body.suggestions[0]).toMatchObject({
      title: 'Intervals', focus: 'endurance', reason: expect.stringMatching(/endurance/i),
    });
    await User.updateOne({ email: 'mona@example.com' }, { $set: { fitnessGoal: 'mobility' } });
    const unmatched = await request(app).get('/api/workouts/suggestions/mona%40example.com');
    expect(unmatched.status).toBe(200);
    expect(unmatched.body.suggestions).toEqual([]);
  });
});
