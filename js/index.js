// 2020.8.31 Y.Minami
// 2022.12.2 Y.Minami
window.addEventListener("DOMContentLoaded", init);

const dt = 0.001; // [sec]
const ref_period = 8000; // [msec]
const VMAX = 5;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const delay = 0.01;
const REF_AMP = 45;

// 物理パラメータの定義
const KJ = 6616;
const BJ = 31.0;

let isRunning = false;
let t = 0.0; // [sec]
let pos = 0.0; // [m]
let angle = 0.0; // [rad]
let gain1 = 0.1;
let gain2 = 0.0;
let gain_integral = 0.0;

let dist_set = 5.0;
let theta_ini = 0.0;
let data = [];

let state = new Array(2).fill(0.0);
let u_stack = new Array(Math.ceil(delay / dt)).fill(0.0);
let integral = 0.0;

let ref_pos = 30;
let ff_input = 0.0;
let disturbance = 0.0;

let voltage = 0.0;
let amp = 0.0;
let freq = 1.0;

const MODES = ["Manual", "Servo", "StateFeedback", "Feedforward"];
let controls;
// let mode = "Feedback";
let input_wave = "step";

const flags = {
    mode: MODES[0],
    // noise: false,
    friction: false,
    inputDelay: true,
    inputConstraint: true,
    I_PD: false,
    REF_AUTO: false,
};

// for plot
var d_pos = [];
var d_angle = [];

function init() {
    const width = 1200;
    const height = 1200;

    // レンダラーを作成
    const renderer = new THREE.WebGLRenderer({
        canvas: document.querySelector("#myCanvas"),
        alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;

    // シーンを作成
    const scene = new THREE.Scene();

    // カメラを作成
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
    camera.position.set(0, 0, +1500);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.2;

    // 箱を作成
    const floor_geometry = new THREE.BoxGeometry(width * 3, height * 3, 1);
    const arm_geometry = new THREE.BoxGeometry(50, 400, 20);
    const box_geometry = new THREE.BoxGeometry(300, 500, 200);
    const circle_geometry = new THREE.CylinderGeometry(15, 15, 20, 32);
    const arm_material = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        //alpha: 0.8,
    });
    const circle_material = new THREE.MeshStandardMaterial({
        color: 0x808080,
    });
    const box_material = new THREE.MeshLambertMaterial({
        color: 0x333333,
    });
    const floor_material = new THREE.MeshStandardMaterial({
        color: 0xfffff0,
    });

    const led_out_geometry = new THREE.CylinderGeometry(18, 18, 50, 64);
    const led_in_geometry = new THREE.CylinderGeometry(15, 15, 50, 64);
    const led_out_material = new THREE.MeshToonMaterial({
        color: 0xf5f5f5,
    });
    const led_in_material = new THREE.MeshBasicMaterial({
        color: 0xffff00,
    });
    const led = new THREE.Group();
    const led_out = new THREE.Mesh(led_out_geometry, led_out_material);
    const led_in = new THREE.Mesh(led_in_geometry, led_in_material);
    led.add(led_out);
    led.add(led_in);

    const arm = new THREE.Mesh(arm_geometry, arm_material);
    const box = new THREE.Mesh(box_geometry, box_material);
    arm.castShadow = true;
    box.castShadow = true;
    const circle = new THREE.Mesh(circle_geometry, circle_material);

    const floor = new THREE.Mesh(floor_geometry, floor_material);
    floor.receiveShadow = true;
    const arm_group = new THREE.Group();

    arm.position.y += 100;
    arm.position.z += 210;
    box.position.z += 100;
    circle.position.y += 0;
    circle.position.z += 220;
    circle.rotation.x = Math.PI / 2;
    arm_group.add(arm);
    arm_group.add(circle);

    scene.add(arm_group);
    scene.add(box);
    scene.add(floor);
    scene.add(led);

    arm_group.position.y += 50;
    box.position.y -= 150;

    led.position.z += 180;
    led.position.x += 100;
    led.position.y -= 300;
    led.rotation.x = Math.PI / 2;

    // 平行光源
    //const directionalLight = new THREE.DirectionalLight(0xffffff);
    //directionalLight.position.set(-20, -20, 30);
    //scene.add(directionalLight);
    // アンビエントライト
    const ambient = new THREE.AmbientLight(0xf8f8ff, 0.7);
    scene.add(ambient);
    const light = new THREE.SpotLight(0xffffff, 2, 2800, Math.PI / 4, 10);
    light.position.set(150, 100, 2000);
    light.castShadow = true;
    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;
    scene.add(light);

    // create GUI
    createGUI();

    // 初回実行
    tick();

    function tick() {
        requestAnimationFrame(tick);
        var n_state = new Array(2).fill(0.0);
        let ref;
        if (isRunning) {
            for (let i = 0; i < 10; i++) {
                //var ref = squareWave(t, ref_period, Math.PI / 2.0);

                if (flags.REF_AUTO == true) {
                    ref = squareWave(t, ref_period, REF_AMP);
                } else {
                    ref = ref_pos;
                }

                let u = 0.0;
                switch (flags.mode) {
                    case "Manual":
                        u = voltage;
                        break;
                    case "Servo":
                        u = sat(servoCont(state, ref));
                        break;
                    case "StateFeedback":
                        ///u = pid(state, ref);
                        u = sat(sf(state));
                        break;
                    case "Feedforward":
                        if (input_wave == "step") {
                            u = amp;
                        } else if (input_wave == "sin") {
                            u = amp * Math.sin(2.0 * Math.PI * freq * t);
                        }
                        break;
                    default:
                        u = 0.0;
                        break;
                }

                u_stack.push(u);

                if (flags.inputDelay == false) {
                    rk4(state, n_state, u, dt);
                } else {
                    rk4(state, n_state, u_stack.shift(), dt);
                }



                if (flags.mode == "Servo" || flags.mode == "StateFeedback") {
                    console.log(t, state[0], state[1]);
                    data.push([
                        t,
                        ref,
                        state[0],
                        u
                    ]); // degに変換
                } else {
                    data.push([t, ref, state[0], u]); // degに変換
                }
                // for next loop
                t += dt;
                prev_state = state;
                state = n_state;
                disturbance = 0.0;
            }
            if (t > 8.0) {
                d_pos.shift();
                d_angle.shift();
            }
            d_pos.push([t, pos]);
            d_angle.push([t, angle]);

            pos = ref;
            angle = state[0];
            led_in_material.color = new THREE.Color(0xff9933);
        } else {
            pos = ref;
            angle = state[0];
            led_in_material.color = new THREE.Color(0x696969);
        }

        switch (flags.mode) {
            case "Manual":
                arm_material.color = new THREE.Color(0xff0000);
                break;
            case "Servo":
                if (flags.I_PD == true) {
                    arm_material.color = new THREE.Color(0xff00ff);
                } else {
                    arm_material.color = new THREE.Color(0xff0000);
                }
                break;
            case "StateFeedback":
                arm_material.color = new THREE.Color(0x0000ff);
                break;
            case "Feedforward":
                arm_material.color = new THREE.Color(0x00ff00);
                break;
            default:
                break;
        }

        // レンダリング
        arm_group.rotation.z = angle * DEG2RAD;
        renderer.render(scene, camera);
        window.requestAnimationFrame(drawPlot);

    }

    onResize();
    window.addEventListener("resize", onResize);

    function onResize() {
        // サイズを取得
        const width = window.innerWidth;
        const height = window.innerHeight;

        // レンダラーのサイズを調整する
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height);

        // カメラのアスペクト比を正す
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
}

function startButton() {
    isRunning = !isRunning;
}

function resetButton() {
    controls.reset();

    t = 0;
    state = Array(2).fill(0.0);
    state[0] = theta_ini;

    u_stack = Array(Math.ceil(delay / dt)).fill(0.0);

    data = [];
    u = 0.0;
    integral = 0.0;

    isRunning = false;

    d_pos = [];
    d_angle = [];

}

function saveButton() {
    isRunning = false;

    let str = "";
    for (let i = 0; i < data.length; i++) {
        var d = data[i];
        str += d[0].toFixed(5) + "," + parseFloat(d[1]).toFixed(5);
        str +=
            "," +
            parseFloat(d[2]).toFixed(5) +
            "," +
            parseFloat(d[3]).toFixed(5) +
            "\n";
    }
    setTimeout(() => {
        let blob = new Blob([str], { type: "text/csv" });
        const a = document.createElement("a"); // aタグの要素を生成
        a.href = URL.createObjectURL(blob);
        a.download = createFilename();
        a.click();
    }, 200)
}

function createFilename() {
    let filename;
    if (flags.mode == "StateFeedback") {
        filename = "data" + ".csv";
    } else {
        filename = "data_ff_" + amp.toFixed(3) + "_";
        filename += freq.toFixed(3) + ".csv";
    }

    return filename;
}

function rk4(state, next_state, u, h) {
    const theta = state[0] + disturbance;
    const dtheta = state[1];

    let k1 = new Array(2);
    let k2 = new Array(2);
    let k3 = new Array(2);
    let k4 = new Array(2);

    k1[0] = f1(theta, dtheta, u);
    k1[1] = f2(theta, dtheta, u);

    k2[0] = f1(theta + (h / 2) * k1[0], dtheta + (h / 2) * k1[1], u);
    k2[1] = f2(theta + (h / 2) * k1[0], dtheta + (h / 2) * k1[1], u);

    k3[0] = f1(theta + (h / 2) * k2[0], dtheta + (h / 2) * k2[1], u);
    k3[1] = f2(theta + (h / 2) * k2[0], dtheta + (h / 2) * k2[1], u);

    k4[0] = f1(theta + h * k3[0], dtheta + h * k3[1], u);
    k4[1] = f2(theta + h * k3[0], dtheta + h * k3[1], u);

    next_state[0] = theta + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    next_state[1] = dtheta + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);

    function f1(theta, dtheta, u) {
        return dtheta;
    }
    function f2(theta, dtheta, u) {
        var u_actual;
        if (flags.friction == true) {
            if (Math.abs(u) < 0.2) {
                // 静摩擦
                u_actual = 0.0;
            } else {
                u_actual = u;
            }
        } else {
            u_actual = u;
        }
        return -dtheta * BJ + u_actual * KJ;
    }
}

function sat(u) {//飽和
    var u_actual;
    if (flags.inputConstraint == true) {
        if (u > VMAX) {
            u_actual = VMAX;
        } else if (u < -VMAX) {
            u_actual = -VMAX;
        } else {
            u_actual = u;
        }
    } else {
        u_actual = u;
    }
    return u_actual;
}

function sf(state) {
    return - gain1 * state[0] - gain2 * state[1] + ff_input;
}

function servoCont(state, ref_pos) {
    let err = ref_pos - state[0];
    integral += err * dt;
    if (flags.I_PD == true) {
        return - gain1 * state[0] - gain2 * state[1] + gain_integral * integral;
    } else {
        return gain1 * err - gain2 * state[1] + gain_integral * integral;
    }
}

function squareWave(t, period, amp) {
    var phase = Math.floor(t / dt) % period;

    if (phase < period / 4.0) {
        return amp;
    } else if (phase < period / 2.0) {
        return 0;
    } else if (phase < (period * 3.0) / 4.0) {
        return -amp;
    } else {
        return 0;
    }
}

let createGUI = function () {
    let text = new guiController();
    let gui = new dat.GUI();
    gui.add(text, "title");
    gui
        .add(text, "mode", ["Manual", "Servo", "StateFeedback", "Feedforward"])
        .onFinishChange(function (value) {
            resetButton();
            flags.mode = value;
            switch (flags.mode) {
                case "Manual":
                    mc.open();
                    fb.close();
                    ff.close();
                    servo.close();
                    break;
                case "StateFeedback":
                    mc.close();
                    fb.open();
                    ff.close();
                    servo.close();
                    break;
                case "Feedforward":
                    mc.close();
                    ff.open();
                    fb.close();
                    servo.close();
                    break;
                case "Servo":
                    mc.close();
                    fb.close();
                    ff.close();
                    servo.open();
                    break;
                default:
                    break;
            }
        });

    let mc = gui.addFolder("Manual");
    mc.add(text, "voltage", -5, 5)
        .step(0.01)
        .onChange(function (value) {
            voltage = value;
        })
        .name("voltage");
    mc.open();

    let servo = gui.addFolder("Servo");
    servo.add(text, "i_pd_")
        .name("I-PD FB")
        .onChange(function (value) {
            flags.I_PD = value;
        });
    servo.add(text, "ref_auto_")
        .name("Reference_Gen")
        .onChange(function (value) {
            flags.REF_AUTO = value;
        });
    servo.add(text, "gain1", 0, 1.0)
        .step(0.000001)
        .onChange(function (value) {
            gain1 = value;
        })
        .name("k1 (kP)");
    servo.add(text, "gain2", -0.01, 1.0)
        .step(0.000001)
        .onChange(function (value) {
            gain2 = value;
        })
        .name("k2 (kD)");
    servo.add(text, "gain_int", -5.0, 5.0)
        .step(0.000001)
        .onChange(function (value) {
            gain_integral = value;
        })
        .name("g (kI)");
    servo.add(text, "ref_position", -90, 90)
        .step(1)
        .onChange(function (value) {
            ref_pos = value;
        })
        .name("ref");

    let fb = gui.addFolder("StateFeedback");
    fb.add(text, "gain1", -0.1, 1.0)
        .step(0.00001)
        .onChange(function (value) {
            gain1 = value;
        })
        .name("k1");
    fb.add(text, "gain2", -0.1, 1.0)
        .step(0.000001)
        .onChange(function (value) {
            gain2 = value;
        })
        .name("k2");
    fb.add(text, "ff_input", -10.0, 10.0)
        .step(0.01)
        .onChange(function (value) {
            ff_input = value;
        })
        .name("ff_input");

    let ff = gui.addFolder("Feedforward");
    ff.add(text, "inputs", ["step", "sin"]).onFinishChange(function (value) {
        resetButton();
        input_wave = value;
    });
    ff.add(text, "amp", 0, 10)
        .onChange(function (value) {
            amp = value;
        })
        .name("amp[V]");

    ff.add(text, "frequency", 0, 100)
        .onChange(function (value) {
            freq = value;
        })
        .name("frequency[Hz]");

    var difficulty = gui.addFolder("difficulty");
    // difficulty.add(text, "noise_")
    //     .name("add noise")
    //     .onChange(function (value) {
    //         flags.noise = value;
    //     });
    difficulty.add(text, "friction_")
        .name("input DeadZone")
        .onChange(function (value) {
            flags.friction = value;
        });
    difficulty.add(text, "inputDelay_")
        .name("input delay")
        .onChange(function (value) {
            flags.inputDelay = value;
        });
    difficulty.add(text, "inputConstraint_")
        .name("input Constraint")
        .onChange(function (value) {
            flags.inputConstraint = value;
        });

    gui.add(text, "theta_ini", -90, 90)
        .step(1)
        .onChange(function (value) {
            theta_ini = value;
        })
        .name("theta(0)");

    gui.add(text, "disturbance", -30, 30)
        .step(1)
        .onChange(function (value) {
            dist_set = value;
        })
        .name("disturbance");

    gui.add(text, "start_stop").name("start/stop");
    gui.add(text, "reset");
    gui.add(text, "save");
};

var guiController = function () {
    this.title = "Arm simulator";
    this.theta_ini = theta_ini;
    this.gain1 = gain1;
    this.gain2 = gain2;
    this.gain_int = gain_integral;

    this.ff_input = ff_input;

    this.ref_position = ref_pos;
    this.disturbance = dist_set;
    this.start_stop = startButton;
    this.reset = resetButton;
    this.save = saveButton;

    this.voltage = voltage;
    this.amp = amp;
    this.frequency = freq;

    this.mode = flags.mode;
    this.inputs = "step";

    // this.noise_ = flags.noise;
    this.friction_ = flags.friction;
    this.inputDelay_ = flags.inputDelay;
    this.modelError_ = flags.modelError;
    this.inputConstraint_ = flags.inputConstraint;
    this.i_pd_ = flags.I_PD;
    this.ref_auto_ = flags.REF_AUTO;
};

var nRand = function (m, s) {
    var a = 1 - Math.random();
    var b = 1 - Math.random();
    var c = Math.sqrt(-2 * Math.log(a));
    if (0.5 - Math.random() > 0) {
        return c * Math.sin(Math.PI * 2 * b) * s + m;
    } else {
        return c * Math.cos(Math.PI * 2 * b) * s + m;
    }
};

function drawPlot() {
    basic_legend(document.getElementById("graph"));
}
function basic_legend(container) {
    var data, graph, i;
    if (flags.mode == "StateFeedback") {
        data = [
            { data: d_angle, label: "angle" },
            { data: d_pos, label: "ref" }
        ];
    } else {
        data = [{ data: d_angle, label: "angle" }, { data: d_pos, label: "ref" }];
    }

    function labelFn(label) {
        return label;
    }
    // グラフを描画する
    var ymax;
    var ymin;
    if (flags.mode == "StateFeedback" || flags.mode == "Servo") {
        ymax = 100;
        ymin = -100;
    } else {
        ymax = 300;
        ymin = -300;
    }
    graph = Flotr.draw(container, data, {
        legend: {
            position: "nw",
            labelFormatter: labelFn,
            //backgroundColor: "#D2E8FF", // 凡例の背景色
        },
        xaxis: {
            title: "time",
        },
        yaxis: {
            max: ymax,
            min: ymin,
            title: "position[m], angle[rad]",
        },
        HtmlText: false,
        colors: ["#e4548e", "#2d91e5", "#e7cf00", "#0cae7b", "#a435c0"],
    });
}


document.addEventListener('keydown',
    event => {
        if (event.key === 'd') {
            disturbance = dist_set;
        }
    });
