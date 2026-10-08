import mongoose from "mongoose";
const schema = new mongoose.Schema({
  _id: { type: String },
  values: { type: mongoose.Schema.Types.Mixed, required: true },
  revision: { type: Number, required: true },
  updated_at: { type: String, required: true }
}, { minimize: false });
export default mongoose.model("Settings", schema);
