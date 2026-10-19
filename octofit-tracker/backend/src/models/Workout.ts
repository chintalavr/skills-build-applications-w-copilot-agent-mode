import { Schema, model } from 'mongoose';

const workoutSchema = new Schema({
  title: String,
  focus: { type: String, required: true },
  minutes: { type: Number, required: true },
  difficulty: { type: String, required: true },
});

export const Workout = model('Workout', workoutSchema);
