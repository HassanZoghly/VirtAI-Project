export const avatarImages = {
  omar: {
    id: 'omar',
    name: 'Dr. Omar',
    image: '/assets/avatar/avatar1.ico',
    modelPath: '/models/avatar1.glb',
    description: 'Friendly and approachable tutor',
    gender: 'male',
  },
};

export const getAvatarById = (id) => avatarImages[id] || avatarImages.omar;
export const getAvatarModelPath = (id) => getAvatarById(id).modelPath;
