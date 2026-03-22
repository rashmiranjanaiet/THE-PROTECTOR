const mongoose = require('mongoose');

const secureDropSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, minlength: 16, maxlength: 16 },
    message: { type: String, required: true, maxlength: 4000 },
    imagePath: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    used: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

secureDropSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SecureDrop', secureDropSchema);