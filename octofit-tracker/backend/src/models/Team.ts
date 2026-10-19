import { Schema, model } from 'mongoose';

const teamSchema = new Schema({
  name: { type: String, required: true },
  mascot: { type: String, required: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

export const Team = model('Team', teamSchema);
