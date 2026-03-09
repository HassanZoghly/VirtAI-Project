export const avatarImages = {
  omar: {
    id: 'omar',
    name: 'Dr. Omar',
    image: '/assets/avatar/avatar1.webp',
    modelPath: '/models/avatar1.glb',
    description: 'Friendly and approachable tutor',
    gender: 'male',
  },
  mariam: {
    id: 'mariam',
    name: 'Dr. Mariam',
    image: '/assets/avatar/avatar2.webp',
    modelPath: '/models/avatar2.glb',
    description: 'Professional and experienced educator',
    gender: 'female',
  },
  khaled: {
    id: 'khaled',
    name: 'Dr. Khaled',
    image: '/assets/avatar/avatar3.webp',
    modelPath: '/models/avatar3.glb',
    description: 'Expert in advanced topics',
    gender: 'male',
  },
};

export const getAvatarById = (id) => avatarImages[id] || avatarImages.omar;
export const getAvatarModelPath = (id) => getAvatarById(id).modelPath;
