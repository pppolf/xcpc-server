import mongoose from 'mongoose';

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // 比如存为 'notice_id'
  seq: { type: Number, default: 0 }      // 当前序号，比如 100
});

export default mongoose.model('Counter', CounterSchema);