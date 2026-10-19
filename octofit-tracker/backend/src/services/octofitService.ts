import { isObjectIdOrHexString } from 'mongoose';
import { Activity, Team, User, Workout } from '../models/index.js';

export async function listActivities() {
  return Activity.find().lean();
}

export async function createActivity(input: unknown) {
  if (
    typeof input !== 'object' || input === null ||
    !('userId' in input) || !('teamId' in input) ||
    !('type' in input) || !('minutes' in input)
  ) {
    throw Object.assign(new Error('Activity requires userId, teamId, type, and minutes'), { status: 400 });
  }

  const { userId, teamId, type, minutes } = input;
  if (
    typeof userId !== 'string' || !isObjectIdOrHexString(userId) ||
    typeof teamId !== 'string' || !isObjectIdOrHexString(teamId) ||
    typeof type !== 'string' || type.trim().length === 0 ||
    typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0
  ) {
    throw Object.assign(new Error('Activity requires valid user and team IDs, a non-empty type, and positive finite minutes'), { status: 400 });
  }

  const [user, team] = await Promise.all([
    User.exists({ _id: userId }),
    Team.exists({ _id: teamId }),
  ]);
  if (!user || !team) {
    throw Object.assign(new Error('Activity user or team not found'), { status: 404 });
  }

  return Activity.create({
    user: userId,
    team: teamId,
    type,
    minutes,
    points: minutes,
    occurredAt: new Date(),
  });
}

export async function listTeams() {
  return Team.find().lean();
}

export async function createTeam(input: unknown) {
  if (
    typeof input !== 'object' || input === null ||
    !('name' in input) || !('mascot' in input)
  ) {
    throw Object.assign(new Error('Team requires name and mascot'), { status: 400 });
  }

  const { name, mascot } = input;
  const members = 'members' in input ? input.members : [];
  if (
    typeof name !== 'string' || name.trim().length === 0 ||
    typeof mascot !== 'string' || mascot.trim().length === 0 ||
    !Array.isArray(members) ||
    !members.every((member): member is string => typeof member === 'string' && isObjectIdOrHexString(member))
  ) {
    throw Object.assign(new Error('Team requires a non-empty name and mascot and an array of valid member IDs'), { status: 400 });
  }

  const memberIds = [...new Set(members.map((member) => member.toLowerCase()))];
  if (memberIds.length > 0 && await User.countDocuments({ _id: { $in: memberIds } }) !== memberIds.length) {
    throw Object.assign(new Error('Team member not found'), { status: 404 });
  }

  return Team.create({ name, mascot, members });
}

export async function getLeaderboard() {
  const teams = await Team.aggregate<{ teamName: string; totalPoints: number }>([
    { $lookup: { from: Activity.collection.name, localField: '_id', foreignField: 'team', as: 'activities' } },
    { $project: { _id: 0, teamName: '$name', totalPoints: { $sum: '$activities.points' } } },
    { $sort: { totalPoints: -1, teamName: 1 } },
  ]);
  return teams.map((team, index) => ({ ...team, rank: index + 1 }));
}

export async function suggestWorkouts(userEmail: string) {
  const user = await User.findOne({ email: userEmail }).lean();
  if (!user) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  const recentActivity = await Activity.findOne({ user: user._id }).sort({ occurredAt: -1, _id: -1 }).lean();
  const activityFocus = new Map([
    ['run', 'endurance'],
    ['cycle', 'endurance'],
    ['strength', 'strength'],
  ]).get(recentActivity?.type ?? '');
  const focuses = [user.fitnessGoal];
  if (activityFocus) focuses.push(activityFocus);

  const workouts = await Workout.find({ focus: { $in: focuses } }).sort({ title: 1, _id: 1 }).lean();
  return workouts
    .sort((a, b) => Number(b.focus === user.fitnessGoal) - Number(a.focus === user.fitnessGoal))
    .map((workout) => ({
      ...workout,
      reason: workout.focus === user.fitnessGoal
        ? `Matches your ${user.fitnessGoal} fitness goal.`
        : `Builds ${workout.focus} from your latest ${recentActivity?.type} activity.`,
    }));
}

export { User };
