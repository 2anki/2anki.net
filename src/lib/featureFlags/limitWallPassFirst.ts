// Runs the pass-first limit wall as a 50/50 test for signed-out visitors whose
// upload is held (src/lib/upload/passFirstArm.ts). On, half of them by anon id
// get the pass-first gate and a sign-up that releases only the 21-card
// preview; the other half and every other limit surface keep the sign-up-first
// wall and the 100-card claim. Off, nobody is assigned an arm.
export const LIMIT_WALL_PASS_FIRST_FLAG = 'limit_wall_pass_first';
