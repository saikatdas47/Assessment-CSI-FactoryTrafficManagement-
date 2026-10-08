import mongoose from "mongoose";
const junctionSchema = new mongoose.Schema(
  {
    _id: { type: String },
    state: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: true, minimize: false }
);
export default mongoose.model("Junction", junctionSchema);
