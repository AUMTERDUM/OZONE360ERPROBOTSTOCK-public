import React from 'react';
import { useNavigate } from 'react-router-dom';
import RobotMascot from '../components/RobotMascot';
import { useAuth } from '../context/AuthContext';

const NotFound: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  return <div className="page-container" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}><div className="card" style={{ textAlign: 'center', padding: '3rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}><RobotMascot scene="notFound" size={180} /><h1 style={{ marginTop: 0 }}>ไม่พบหน้านี้</h1><p className="text-muted">หุ่นยนต์ของเราหลงทาง หาหน้าที่คุณต้องการไม่เจอ</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>{window.history.length > 1 && <button className="btn btn-outline" onClick={() => navigate(-1)}>ย้อนกลับ</button>}{isAuthenticated ? <button className="btn btn-primary" onClick={() => navigate('/')}>กลับแดชบอร์ด</button> : <a className="btn btn-primary" href="tel:0800000001">โทรหาทีมงาน 080-000-0001</a>}</div></div></div>;
};
export default NotFound;
