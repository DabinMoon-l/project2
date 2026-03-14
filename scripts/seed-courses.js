/**
 * courses 컬렉션 시드 스크립트
 * 기본 3과목을 Firestore courses/{courseId} 문서로 등록
 *
 * 사용법: node scripts/seed-courses.js
 */

const admin = require('firebase-admin');
const path = require('path');

// 서비스 계정 키 경로
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
  });
}

const db = admin.firestore();

const COURSES = {
  biology: {
    name: '생물학',
    nameEn: 'Biology',
    grade: 1,
    semester: 1,
    isUniverseSeparated: false,
    classes: ['A', 'B', 'C', 'D'],
    themeId: 'biology',
    order: 1,
    quizRibbonImage: '/images/biology-quiz-ribbon.png',
    reviewRibbonImage: '/images/biology-review-ribbon.png',
    quizRibbonScale: 1,
    reviewRibbonScale: 1,
    studentsRibbonImage: '/images/biology-students-ribbon.png',
    studentsRibbonScale: 1,
    dashboardRibbonImage: '/images/biology-dashboard-ribbon.png',
    dashboardRibbonScale: 1,
  },
  microbiology: {
    name: '미생물학',
    nameEn: 'Microbiology',
    grade: 2,
    semester: 1,
    isUniverseSeparated: false,
    classes: ['A', 'B', 'C', 'D'],
    order: 2,
    quizRibbonImage: '/images/microbiology-quiz-ribbon.png',
    reviewRibbonImage: '/images/microbiology-review-ribbon.png',
    quizRibbonScale: 1,
    reviewRibbonScale: 1,
    studentsRibbonImage: '/images/microbiology-students-ribbon.png',
    studentsRibbonScale: 1,
    dashboardRibbonImage: '/images/microbiology-dashboard-ribbon.png',
    dashboardRibbonScale: 1,
  },
  pathophysiology: {
    name: '병태생리학',
    nameEn: 'Pathophysiology',
    grade: 1,
    semester: 2,
    isUniverseSeparated: false,
    classes: ['A', 'B', 'C', 'D'],
    order: 3,
    quizRibbonImage: '/images/pathophysiology-quiz-ribbon.png',
    reviewRibbonImage: '/images/pathophysiology-review-ribbon.png',
    quizRibbonScale: 1,
    reviewRibbonScale: 1,
    studentsRibbonImage: '/images/pathophysiology-students-ribbon.png',
    studentsRibbonScale: 1,
    dashboardRibbonImage: '/images/pathophysiology-dashboard-ribbon.png',
    dashboardRibbonScale: 1,
  },
};

async function seedCourses() {
  const batch = db.batch();

  for (const [courseId, courseData] of Object.entries(COURSES)) {
    const ref = db.collection('courses').doc(courseId);
    batch.set(ref, courseData, { merge: true });
    console.log(`  → courses/${courseId} 설정`);
  }

  await batch.commit();
  console.log(`\n✅ ${Object.keys(COURSES).length}개 과목 시드 완료`);
}

seedCourses()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('시드 실패:', err);
    process.exit(1);
  });
